const { withTenantClient } = require('../config/db');
const invoiceModel = require('./invoice.model');

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
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);
    return { payment: paymentResult.rows[0], invoice };
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
 * since financial records need to remain auditable.
 */
async function voidPayment(schoolId, paymentId, invoiceId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE payments SET deleted_at = now() WHERE id = $1 AND school_id = $2 RETURNING id`,
      [paymentId, schoolId]
    );
    if (result.rows.length === 0) return null;
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);
    return { voidedPaymentId: result.rows[0].id, invoice };
  });
}

module.exports = { recordManualPayment, listByInvoice, listByStudent, voidPayment };
