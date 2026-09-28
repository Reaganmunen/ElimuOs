const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

/**
 * Generates an invoice for a student for a given term, itemizing every
 * fee_structure row that applies to the student's current grade/term.
 * Fails loudly if an invoice already exists for this student+term (the
 * schema enforces one invoice per student per term) rather than silently
 * duplicating charges.
 */
const EFF_STATUS = `(CASE WHEN i.status = 'unpaid' AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE THEN 'overdue' ELSE i.status END)`;

async function generateForStudent(schoolId, studentId, termId, dueDate, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const studentRow = await client.query(
      `SELECT s.id, c.grade_id FROM students s
       JOIN classes c ON c.id = s.current_class_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [studentId, schoolId]
    );
    if (studentRow.rows.length === 0) {
      throw new Error('Student not found or has no assigned class');
    }
    const { grade_id: gradeId } = studentRow.rows[0];

    const feeItems = await client.query(
      `SELECT * FROM fee_structures WHERE school_id = $1 AND grade_id = $2 AND term_id = $3`,
      [schoolId, gradeId, termId]
    );
    if (feeItems.rows.length === 0) {
      throw new Error('No fee structure defined for this grade/term — set one up before invoicing');
    }

    const totalAmount = feeItems.rows.reduce((sum, item) => sum + Number(item.amount), 0);

    const invoiceResult = await client.query(
      `INSERT INTO invoices (school_id, student_id, term_id, total_amount, due_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, studentId, termId, totalAmount, dueDate || null]
    );
    const invoice = invoiceResult.rows[0];

    for (const item of feeItems.rows) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, fee_structure_id, description, amount)
         VALUES ($1,$2,$3,$4)`,
        [invoice.id, item.id, item.item_name, item.amount]
      );
    }

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'create', tableName: 'invoices', recordId: invoice.id,
      details: { studentId, termId, totalAmount },
    });

    return invoice;
  });
}

async function getById(schoolId, invoiceId) {
  return withTenantClient(schoolId, async (client) => {
    const invoiceResult = await client.query(
      `SELECT i.*, s.full_name AS student_name, s.admission_number
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.id = $1 AND i.school_id = $2`,
      [invoiceId, schoolId]
    );
    if (invoiceResult.rows.length === 0) return null;

    const itemsResult = await client.query(
      `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoiceId]
    );
    const adjustments = await require('./feeAdjustment.model').listForInvoice(client, invoiceId);
    return { ...invoiceResult.rows[0], items: itemsResult.rows, adjustments };
  });
}

async function listByStudent(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM invoices WHERE student_id = $1 AND school_id = $2 ORDER BY created_at DESC`,
      [studentId, schoolId]
    );
    return result.rows;
  });
}

async function listOutstanding(schoolId, { limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT i.*, ${EFF_STATUS} AS status, s.full_name AS student_name, s.admission_number
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.school_id = $1 AND i.status IN ('unpaid','partial','overdue')
       ORDER BY i.due_date ASC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, offset]
    );
    return result.rows;
  });
}

async function listAll(schoolId, { termId, status, classId, q, limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    let where = 'i.school_id = $1';
    if (termId) { params.push(termId); where += ` AND i.term_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND ${EFF_STATUS} = $${params.length}`; }
    if (classId) { params.push(classId); where += ` AND s.current_class_id = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (s.full_name ILIKE $${params.length} OR s.admission_number ILIKE $${params.length})`; }
    const from = `FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${where}`;
    const total = await client.query(`SELECT COUNT(*)::int AS n ${from}`, params);
    params.push(limit, offset);
    const rows = await client.query(
      `SELECT i.*, ${EFF_STATUS} AS status, s.full_name AS student_name, s.admission_number ${from}
       ORDER BY i.due_date ASC NULLS LAST, s.full_name LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );
    return { items: rows.rows, total: total.rows[0].n };
  });
}

/** Billed / collected across ALL invoices (paid ones included), optionally for one term or class. */
async function summary(schoolId, { termId, classId } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    let where = 'i.school_id = $1';
    if (termId) { params.push(termId); where += ` AND i.term_id = $${params.length}`; }
    if (classId) { params.push(classId); where += ` AND s.current_class_id = $${params.length}`; }
    const r = await client.query(
      `SELECT COALESCE(SUM(i.total_amount),0) AS billed, COALESCE(SUM(i.amount_paid),0) AS collected,
              COUNT(*)::int AS invoices, COUNT(*) FILTER (WHERE ${EFF_STATUS} = 'overdue')::int AS overdue,
              COUNT(*) FILTER (WHERE i.status = 'paid')::int AS paid
       FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${where}`, params
    );
    return r.rows[0];
  });
}

/**
 * Recomputes amount_paid and status from the sum of non-voided payments.
 * Called by the payment model after every payment is recorded or reversed —
 * kept here (not duplicated in the payment model) so invoice state always
 * derives from a single source of truth: the payments table itself.
 */
async function recalculateStatus(client, invoiceId) {
  const sumResult = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = $1 AND deleted_at IS NULL`,
    [invoiceId]
  );
  const amountPaid = Number(sumResult.rows[0].paid);

  const invoiceResult = await client.query(`SELECT total_amount, due_date FROM invoices WHERE id = $1`, [invoiceId]);
  const { total_amount: totalAmount, due_date: dueDate } = invoiceResult.rows[0];

  // A fully-bursaried invoice has a zero total but still has lines; it counts as settled.
  const itemCount = await client.query(`SELECT COUNT(*)::int AS n FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
  let status = 'unpaid';
  if (amountPaid >= Number(totalAmount) && (Number(totalAmount) > 0 || itemCount.rows[0].n > 0)) {
    status = 'paid';
  } else if (amountPaid > 0) {
    status = 'partial';
  } else if (dueDate && new Date(dueDate) < new Date()) {
    status = 'overdue';
  }

  const result = await client.query(
    `UPDATE invoices SET amount_paid = $1, status = $2 WHERE id = $3 RETURNING *`,
    [amountPaid, status, invoiceId]
  );
  return result.rows[0];
}

module.exports = { generateForStudent, getById, listByStudent, listOutstanding, listAll, summary, recalculateStatus };