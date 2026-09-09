const { withTenantClient } = require('../config/db');
const { query } = require('../config/db');
const invoiceModel = require('./invoice.model');

async function createPending(schoolId, { invoiceId, checkoutRequestId, merchantRequestId, phoneNumber, amount }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO mpesa_transactions (school_id, invoice_id, checkout_request_id, merchant_request_id, phone_number, amount)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [schoolId, invoiceId, checkoutRequestId, merchantRequestId, phoneNumber, amount]
    );
    return result.rows[0];
  });
}

/**
 * Looks up a transaction by Daraja's checkout_request_id WITHOUT tenant
 * scoping — this is deliberate. The Daraja callback endpoint is public
 * (Safaricom calls it, not an authenticated school user) and arrives with
 * no JWT, so we don't have a school_id to scope by yet. checkout_request_id
 * is globally unique (Daraja-issued), so this lookup is safe: it's how we
 * DISCOVER which school the callback belongs to, not a tenant-bypass.
 */
async function findByCheckoutRequestId(checkoutRequestId) {
  const result = await query(
    `SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1`,
    [checkoutRequestId]
  );
  return result.rows[0] || null;
}

/**
 * Applies a Daraja callback: updates the transaction's status, and on
 * success, creates the corresponding `payments` row and recalculates the
 * invoice — all in one transaction so a payment can never exist without
 * updating the invoice, or vice versa.
 */
async function applyCallback({ checkoutRequestId, resultCode, resultDesc, mpesaReceiptNumber, amountPaid, rawPayload }) {
  const txn = await findByCheckoutRequestId(checkoutRequestId);
  if (!txn) {
    throw new Error(`No M-Pesa transaction found for checkout_request_id ${checkoutRequestId}`);
  }

  return withTenantClient(txn.school_id, async (client) => {
    const status = String(resultCode) === '0' ? 'success' : 'failed';

    const updated = await client.query(
      `UPDATE mpesa_transactions
       SET status = $1, result_code = $2, result_desc = $3, raw_callback_payload = $4, completed_at = now()
       WHERE id = $5 RETURNING *`,
      [status, resultCode, resultDesc, JSON.stringify(rawPayload || {}), txn.id]
    );

    let payment = null;
    let invoice = null;
    if (status === 'success' && txn.invoice_id) {
      const paymentResult = await client.query(
        `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, mpesa_receipt_number)
         SELECT school_id, id, student_id, $1, 'mpesa', $2 FROM invoices WHERE id = $3
         RETURNING *`,
        [amountPaid || txn.amount, mpesaReceiptNumber, txn.invoice_id]
      );
      payment = paymentResult.rows[0];
      invoice = await invoiceModel.recalculateStatus(client, txn.invoice_id);
    }

    return { transaction: updated.rows[0], payment, invoice };
  });
}

async function listByInvoice(schoolId, invoiceId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM mpesa_transactions WHERE invoice_id = $1 AND school_id = $2 ORDER BY initiated_at DESC`,
      [invoiceId, schoolId]
    );
    return result.rows;
  });
}

module.exports = { createPending, findByCheckoutRequestId, applyCallback, listByInvoice };
