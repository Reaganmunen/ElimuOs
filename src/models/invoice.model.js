const { withTenantClient } = require('../config/db');

/**
 * Generates an invoice for a student for a given term, itemizing every
 * fee_structure row that applies to the student's current grade/term.
 * Fails loudly if an invoice already exists for this student+term (the
 * schema enforces one invoice per student per term) rather than silently
 * duplicating charges.
 */
async function generateForStudent(schoolId, studentId, termId, dueDate) {
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
      `SELECT * FROM invoice_items WHERE invoice_id = $1`,
      [invoiceId]
    );
    return { ...invoiceResult.rows[0], items: itemsResult.rows };
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
      `SELECT i.*, s.full_name AS student_name, s.admission_number
       FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.school_id = $1 AND i.status IN ('unpaid','partial','overdue')
       ORDER BY i.due_date ASC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, offset]
    );
    return result.rows;
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

  let status = 'unpaid';
  if (amountPaid >= Number(totalAmount) && Number(totalAmount) > 0) {
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

module.exports = { generateForStudent, getById, listByStudent, listOutstanding, recalculateStatus };
