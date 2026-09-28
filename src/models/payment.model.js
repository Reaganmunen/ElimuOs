const { withTenantClient } = require('../config/db');
const invoiceModel = require('./invoice.model');
const { recordAudit } = require('../utils/auditLog.util');

/**
 * Records a manually-collected payment (cash/bank/cheque) against an
 * invoice and recalculates the invoice's paid amount/status in the same
 * transaction, so the two never drift out of sync. M-Pesa payments go
 * through mpesa.model.js's callback handler instead, which calls the same
 * recalculateStatus() after inserting its own payment row.
 */
const MANUAL_METHODS = ['cash', 'bank', 'cheque'];

async function recordManualPayment(schoolId, { invoiceId, studentId, amount, method, referenceNote, receivedBy }) {
  if (method === 'mpesa') {
    throw new Error('M-Pesa payments must go through the mpesa STK push / callback flow, not this endpoint');
  }
  if (!MANUAL_METHODS.includes(method)) throw new Error(`method must be one of: ${MANUAL_METHODS.join(', ')}`);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount must be a number greater than 0');

  return withTenantClient(schoolId, async (client) => {
    // Lock the invoice row so two accountants can't both pass the balance check at once.
    const inv = await client.query(
      `SELECT student_id, total_amount, amount_paid FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [invoiceId, schoolId]
    );
    if (inv.rows.length === 0) throw new Error('Invoice not found');
    if (String(inv.rows[0].student_id) !== String(studentId)) throw new Error('This invoice does not belong to that student');
    const balance = Number(inv.rows[0].total_amount) - Number(inv.rows[0].amount_paid || 0);
    if (balance <= 0) throw new Error('This invoice is already fully paid');
    if (amt > balance + 0.005) throw new Error(`Amount exceeds the outstanding balance of KES ${balance.toLocaleString('en-KE')}`);

    const paymentResult = await client.query(
      `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, reference_note, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [schoolId, invoiceId, studentId, amt, method, referenceNote, receivedBy]
    );
    const payment = paymentResult.rows[0];
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);
    await recordAudit(client, {
      schoolId, userId: receivedBy, action: 'create', tableName: 'payments', recordId: payment.id,
      details: { invoiceId, amount: amt, method },
    });
    return { payment, invoice };
  });
}

async function listByInvoice(schoolId, invoiceId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM payments WHERE invoice_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY paid_at DESC`,
      [invoiceId, schoolId]
    );
    return result.rows;
  });
}

async function listByStudent(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM payments WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY paid_at DESC`,
      [studentId, schoolId]
    );
    return result.rows;
  });
}

/**
 * Voids (soft-deletes) a payment — e.g. a bounced cheque or data-entry
 * error — and recalculates the invoice. Never hard-deletes a payment row,
 * since financial records need to remain auditable. This is exactly the
 * kind of action that most needs an audit trail: it makes recorded money
 * disappear from a balance, so "who did this and when" matters a lot.
 */
async function voidPayment(schoolId, paymentId, actorUserId, reason) {
  return withTenantClient(schoolId, async (client) => {
    // The invoice to recalculate comes from the payment row itself, never from the request.
    const found = await client.query(
      `SELECT id, invoice_id, amount FROM payments WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [paymentId, schoolId]
    );
    if (found.rows.length === 0) return null;
    const { id, invoice_id: invoiceId, amount } = found.rows[0];
    await client.query(`UPDATE payments SET deleted_at = now() WHERE id = $1`, [id]);
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'void', tableName: 'payments', recordId: id,
      details: { invoiceId, voidedAmount: amount, reason: reason || null },
    });
    return { voidedPaymentId: id, invoice };
  });
}

/** School-wide payments ledger (cash-up): filter by paid date range and method, with totals per method. */
async function listLedger(schoolId, { from, to, method, limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    let where = 'p.school_id = $1 AND p.deleted_at IS NULL';
    if (from) { params.push(from); where += ` AND p.paid_at >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` AND p.paid_at < ($${params.length}::date + 1)`; }
    if (method) { params.push(method); where += ` AND p.method = $${params.length}`; }
    const base = `FROM payments p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.received_by WHERE ${where}`;
    const byMethod = await client.query(
      `SELECT p.method, COUNT(*)::int AS count, SUM(p.amount) AS total ${base} GROUP BY p.method ORDER BY total DESC`, params
    );
    params.push(limit, offset);
    const rows = await client.query(
      `SELECT p.*, s.full_name AS student_name, s.admission_number, u.full_name AS received_by_name ${base}
       ORDER BY p.paid_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );
    const total = byMethod.rows.reduce((t, r) => t + Number(r.total), 0);
    const count = byMethod.rows.reduce((t, r) => t + r.count, 0);
    return { items: rows.rows, summary: { total, count, byMethod: byMethod.rows } };
  });
}

/**
 * Records money handed BACK to a parent. Stored as a negative payment (is_refund) so the invoice's
 * paid amount, the ledger and cash-up net out automatically. Only allowed up to the invoice's
 * credit (paid above total, e.g. after a bursary is applied to an already-paid invoice).
 * This only records the refund — the money itself is paid out separately.
 */
async function recordRefund(schoolId, { invoiceId, amount, method, reason, referenceNote, receivedBy }) {
  if (!['cash', 'bank', 'cheque', 'mpesa'].includes(method)) throw new Error('method must be one of: cash, bank, cheque, mpesa');
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('amount must be a number greater than 0');
  const why = typeof reason === 'string' ? reason.trim().slice(0, 200) : '';
  if (why.length < 3) throw new Error('A reason is required');

  return withTenantClient(schoolId, async (client) => {
    const inv = await client.query(
      `SELECT student_id, total_amount, amount_paid FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`, [invoiceId, schoolId]
    );
    if (inv.rows.length === 0) throw new Error('Invoice not found');
    const credit = Number(inv.rows[0].amount_paid || 0) - Number(inv.rows[0].total_amount);
    if (credit <= 0.005) throw new Error('This invoice has no credit to refund');
    if (amt > credit + 0.005) throw new Error(`Refund exceeds the credit of KES ${credit.toLocaleString('en-KE')}`);
    const note = `Refund: ${why}${referenceNote ? ` · ${String(referenceNote).trim().slice(0, 80)}` : ''}`;
    const paymentResult = await client.query(
      `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, reference_note, received_by, is_refund)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
      [schoolId, invoiceId, inv.rows[0].student_id, -amt, method, note, receivedBy]
    );
    const payment = paymentResult.rows[0];
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);
    await recordAudit(client, {
      schoolId, userId: receivedBy, action: 'refund', tableName: 'payments', recordId: payment.id,
      details: { invoiceId, amount: amt, method, reason: why },
    });
    return { payment, invoice };
  });
}

module.exports = { recordRefund, recordManualPayment, listByInvoice, listByStudent, voidPayment, listLedger };