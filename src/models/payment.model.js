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
async function recordManualPayment(schoolId, { invoiceId, studentId, amount, method, referenceNote, receivedBy }) {
  if (method === 'mpesa') {
    throw new Error('M-Pesa payments must go through the mpesa STK push / callback flow, not this endpoint');
  }
  return withTenantClient(schoolId, async (client) => {
    const paymentResult = await client.query(
      `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, reference_note, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [schoolId, invoiceId, studentId, amount, method, referenceNote, receivedBy]
    );
    const payment = paymentResult.rows[0];
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);

    // receivedBy IS the actor here — the staff member who took the cash/
    // cheque/bank payment — so no separate actorUserId param is needed.
    await recordAudit(client, {
      schoolId, userId: receivedBy, action: 'create', tableName: 'payments', recordId: payment.id,
      details: { invoiceId, amount, method },
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
async function voidPayment(schoolId, paymentId, invoiceId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE payments SET deleted_at = now() WHERE id = $1 AND school_id = $2 RETURNING id, amount`,
      [paymentId, schoolId]
    );
    if (result.rows.length === 0) return null;
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'void', tableName: 'payments', recordId: result.rows[0].id,
      details: { invoiceId, voidedAmount: result.rows[0].amount },
    });

    return { voidedPaymentId: result.rows[0].id, invoice };
  });
}

module.exports = { recordManualPayment, listByInvoice, listByStudent, voidPayment };