const { withTenantClient } = require('../config/db');
const ApiError = require('../utils/ApiError');
const invoiceModel = require('./invoice.model');
const { recordAudit } = require('../utils/auditLog.util');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// =====================================================================
// C2B - customers paying the school's paybill / till directly
// =====================================================================

/**
 * Daraja sends TransTime as YYYYMMDDHHmmss in East Africa Time.
 * Returns an ISO string, or null if it doesn't look right.
 */
function parseTransTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Works out which student a payment's "account number" points at:
 *  1. the student's admission number (case/space-insensitive), else
 *  2. an invoice reference like FEE-1042 (the same format STK prompts use).
 * Returns the student id, or null when there's no confident single match.
 */
async function resolveStudent(client, schoolId, billRef) {
  const ref = String(billRef || '').trim();
  if (!ref) return null;

  const byAdmission = await client.query(
    `SELECT id FROM students
      WHERE school_id = $1 AND deleted_at IS NULL
        AND upper(regexp_replace(admission_number, '\\s', '', 'g')) = upper(regexp_replace($2, '\\s', '', 'g'))
      LIMIT 2`,
    [schoolId, ref]
  );
  if (byAdmission.rows.length === 1) return byAdmission.rows[0].id;
  if (byAdmission.rows.length > 1) return null; // ambiguous - leave it for a human

  const m = /^[A-Za-z0-9]+-(\d{1,12})$/.exec(ref);
  if (m) {
    const inv = await client.query(`SELECT student_id FROM invoices WHERE id = $1 AND school_id = $2`, [m[1], schoolId]);
    if (inv.rows[0]) return inv.rows[0].student_id;
  }
  return null;
}

/** Used by the validation URL: does this account number match a student? */
async function accountMatches(schoolId, billRef) {
  return withTenantClient(schoolId, async (client) => !!(await resolveStudent(client, schoolId, billRef)));
}

/**
 * Applies `amount` to a student's outstanding invoices, oldest first. Anything
 * left after every invoice is settled is added to the last invoice as credit
 * (the money really arrived - it must be recorded, and the existing refund
 * flow already handles credit). Returns the parts applied, or [] if the
 * student has nothing outstanding.
 */
async function allocateToStudent(client, schoolId, { studentId, amount, receipt, note }) {
  const invoices = await client.query(
    `SELECT id, total_amount, amount_paid FROM invoices
      WHERE school_id = $1 AND student_id = $2 AND status IN ('unpaid','partial','overdue')
      ORDER BY due_date ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE`,
    [schoolId, studentId]
  );

  let remaining = round2(amount);
  const parts = [];
  for (const inv of invoices.rows) {
    if (remaining <= 0.005) break;
    const balance = round2(Number(inv.total_amount) - Number(inv.amount_paid || 0));
    if (balance <= 0.005) continue;
    const apply = Math.min(remaining, balance);
    parts.push({ invoiceId: inv.id, amount: round2(apply) });
    remaining = round2(remaining - apply);
  }
  if (parts.length === 0) return [];
  if (remaining > 0.005) parts[parts.length - 1].amount = round2(parts[parts.length - 1].amount + remaining);

  for (const part of parts) {
    const pay = await client.query(
      `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, mpesa_receipt_number, reference_note)
       VALUES ($1,$2,$3,$4,'mpesa',$5,$6) RETURNING id`,
      [schoolId, part.invoiceId, studentId, part.amount, receipt, note]
    );
    part.paymentId = pay.rows[0].id;
    await invoiceModel.recalculateStatus(client, part.invoiceId);
  }
  return parts;
}

/**
 * Records a C2B confirmation and, when the account number identifies a
 * student with something owing, applies it to their invoices - all in one
 * transaction. Idempotent on (school_id, trans_id): Safaricom retries are a no-op.
 */
async function recordC2BPayment(schoolId, body) {
  const transId = String(body.TransID || '').trim().slice(0, 30);
  const amount = round2(body.TransAmount);
  if (!transId || !Number.isFinite(amount) || amount <= 0) throw new Error('Malformed C2B confirmation payload');

  const payerName = [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(' ').trim().slice(0, 150) || null;

  return withTenantClient(schoolId, async (client) => {
    const inserted = await client.query(
      `INSERT INTO mpesa_c2b_transactions
         (school_id, trans_id, transaction_type, trans_time, amount, business_shortcode, bill_ref_number, msisdn, payer_name, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (school_id, trans_id) DO NOTHING
       RETURNING *`,
      [
        schoolId, transId, body.TransactionType ? String(body.TransactionType).slice(0, 30) : null,
        parseTransTime(body.TransTime), amount,
        body.BusinessShortCode ? String(body.BusinessShortCode).slice(0, 20) : null,
        body.BillRefNumber ? String(body.BillRefNumber).slice(0, 60) : null,
        body.MSISDN ? String(body.MSISDN).slice(0, 80) : null,
        payerName, JSON.stringify(body),
      ]
    );
    if (inserted.rows.length === 0) return { duplicate: true };
    const txn = inserted.rows[0];

    const studentId = await resolveStudent(client, schoolId, txn.bill_ref_number);
    if (!studentId) {
      await client.query(
        `UPDATE mpesa_c2b_transactions SET note = $2 WHERE id = $1`,
        [txn.id, txn.bill_ref_number ? 'The account number did not match a student' : 'No account number was given']
      );
      return { duplicate: false, status: 'unallocated' };
    }

    const parts = await allocateToStudent(client, schoolId, {
      studentId, amount, receipt: transId, note: `Paybill/Till payment${txn.bill_ref_number ? ` (${txn.bill_ref_number})` : ''}`.slice(0, 100),
    });
    if (parts.length === 0) {
      await client.query(
        `UPDATE mpesa_c2b_transactions SET student_id = $2, note = $3 WHERE id = $1`,
        [txn.id, studentId, 'Matched a student, but they have no outstanding invoice']
      );
      return { duplicate: false, status: 'unallocated' };
    }

    await client.query(
      `UPDATE mpesa_c2b_transactions
          SET status = 'allocated', student_id = $2, allocations = $3, resolved_at = now()
        WHERE id = $1`,
      [txn.id, studentId, JSON.stringify(parts)]
    );
    for (const part of parts) {
      await recordAudit(client, {
        schoolId, userId: null, action: 'create', tableName: 'payments', recordId: part.paymentId,
        details: { invoiceId: part.invoiceId, amount: part.amount, method: 'mpesa', mpesaReceiptNumber: transId, source: 'c2b_confirmation' },
      });
    }
    return { duplicate: false, status: 'allocated' };
  });
}

/** School-wide list of direct payments, with counts per status. */
async function listC2B(schoolId, { status, q, from, to, limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    let where = 'c.school_id = $1';
    if (from) { params.push(from); where += ` AND c.received_at >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` AND c.received_at < ($${params.length}::date + 1)`; }
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where += ` AND (c.trans_id ILIKE ${p} OR c.bill_ref_number ILIKE ${p} OR c.msisdn ILIKE ${p} OR c.payer_name ILIKE ${p} OR s.full_name ILIKE ${p} OR s.admission_number ILIKE ${p})`;
    }
    const joins = `FROM mpesa_c2b_transactions c LEFT JOIN students s ON s.id = c.student_id`;
    const counts = await client.query(
      `SELECT c.status, COUNT(*)::int AS n, COALESCE(SUM(c.amount),0) AS total ${joins} WHERE ${where} GROUP BY c.status`, params
    );
    const rowParams = [...params];
    let rowWhere = where;
    if (status) { rowParams.push(status); rowWhere += ` AND c.status = $${rowParams.length}`; }
    rowParams.push(limit, offset);
    const rows = await client.query(
      `SELECT c.id, c.trans_id, c.transaction_type, c.trans_time, c.amount, c.bill_ref_number, c.msisdn, c.payer_name,
              c.status, c.note, c.allocations, c.received_at, c.resolved_at,
              s.full_name AS student_name, s.admission_number
         ${joins} WHERE ${rowWhere}
        ORDER BY c.received_at DESC LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    );
    return { items: rows.rows, counts: counts.rows };
  });
}

/** Manually applies an unallocated direct payment to a chosen invoice. */
async function allocateManually(schoolId, id, invoiceId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const t = await client.query(
      `SELECT * FROM mpesa_c2b_transactions WHERE id = $1 AND school_id = $2 FOR UPDATE`, [id, schoolId]
    );
    const txn = t.rows[0];
    if (!txn) return null;
    if (txn.status !== 'unallocated') throw new ApiError(409, 'This payment has already been handled');

    const inv = await client.query(
      `SELECT id, student_id FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`, [invoiceId, schoolId]
    );
    if (inv.rows.length === 0) throw new ApiError(404, 'Invoice not found');
    const studentId = inv.rows[0].student_id;

    const amount = round2(txn.amount);
    const pay = await client.query(
      `INSERT INTO payments (school_id, invoice_id, student_id, amount, method, mpesa_receipt_number, reference_note, received_by)
       VALUES ($1,$2,$3,$4,'mpesa',$5,$6,$7) RETURNING id`,
      [schoolId, invoiceId, studentId, amount, txn.trans_id,
        `Paybill/Till payment${txn.bill_ref_number ? ` (${txn.bill_ref_number})` : ''} - allocated manually`.slice(0, 100), actorUserId]
    );
    const paymentId = pay.rows[0].id;
    const invoice = await invoiceModel.recalculateStatus(client, invoiceId);

    const updated = await client.query(
      `UPDATE mpesa_c2b_transactions
          SET status = 'allocated', student_id = $2, allocations = $3, resolved_at = now(), resolved_by = $4
        WHERE id = $1 RETURNING *`,
      [id, studentId, JSON.stringify([{ invoiceId: Number(invoiceId), paymentId, amount }]), actorUserId]
    );
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'allocate', tableName: 'mpesa_c2b_transactions', recordId: id,
      details: { invoiceId, amount, mpesaReceiptNumber: txn.trans_id },
    });
    return { transaction: updated.rows[0], invoice };
  });
}

/** Marks an unallocated direct payment as "not a fee payment" (with a reason). */
async function ignoreC2B(schoolId, id, reason, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const t = await client.query(
      `SELECT status, trans_id, amount FROM mpesa_c2b_transactions WHERE id = $1 AND school_id = $2 FOR UPDATE`, [id, schoolId]
    );
    if (!t.rows[0]) return null;
    if (t.rows[0].status !== 'unallocated') throw new ApiError(409, 'This payment has already been handled');
    const updated = await client.query(
      `UPDATE mpesa_c2b_transactions
          SET status = 'ignored', note = $2, resolved_at = now(), resolved_by = $3
        WHERE id = $1 RETURNING *`,
      [id, reason, actorUserId]
    );
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'ignore', tableName: 'mpesa_c2b_transactions', recordId: id,
      details: { reason, mpesaReceiptNumber: t.rows[0].trans_id, amount: t.rows[0].amount },
    });
    return updated.rows[0];
  });
}

// =====================================================================
// B2B - the school paying another paybill / till
// =====================================================================

/** True if an identical payment was started in the last minute (double-click / retry guard). */
async function hasRecentDuplicateB2B(schoolId, { partyB, amount, accountReference }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT 1 FROM mpesa_b2b_transactions
        WHERE school_id = $1 AND party_b = $2 AND amount = $3
          AND COALESCE(account_reference,'') = COALESCE($4,'')
          AND status IN ('pending','success') AND initiated_at > now() - interval '60 seconds'
        LIMIT 1`,
      [schoolId, partyB, amount, accountReference || null]
    );
    return r.rows.length > 0;
  });
}

/** Records a B2B attempt - 'pending' once Safaricom accepted the request, or 'failed' if it was refused up front. */
async function createB2B(schoolId, row, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `INSERT INTO mpesa_b2b_transactions
         (school_id, command_id, party_a, party_b, account_reference, amount, remarks, status,
          originator_conversation_id, conversation_id, result_desc, initiated_by, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $8::varchar = 'failed' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        schoolId, row.commandId, row.partyA, row.partyB, row.accountReference || null, row.amount, row.remarks || null,
        row.status, row.originatorConversationId || null, row.conversationId || null, row.resultDesc || null, actorUserId,
      ]
    );
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'b2b_send', tableName: 'mpesa_b2b_transactions', recordId: r.rows[0].id,
      details: { commandId: row.commandId, partyB: row.partyB, amount: row.amount, accountReference: row.accountReference || null, status: row.status },
    });
    return r.rows[0];
  });
}

/** Applies Safaricom's final result. Also fixes up a row that was marked 'timeout' earlier. */
async function applyB2BResult(schoolId, body) {
  const result = body && body.Result;
  const originator = result && result.OriginatorConversationID;
  if (!result || !originator) throw new Error('Malformed B2B result payload');
  const status = String(result.ResultCode) === '0' ? 'success' : 'failed';

  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE mpesa_b2b_transactions
          SET status = $1, result_code = $2, result_desc = $3, transaction_id = $4,
              conversation_id = COALESCE(conversation_id, $5), raw_result = $6, completed_at = now()
        WHERE school_id = $7 AND originator_conversation_id = $8 AND status IN ('pending','timeout')
        RETURNING *`,
      [
        status, String(result.ResultCode).slice(0, 10), result.ResultDesc || null,
        result.TransactionID ? String(result.TransactionID).slice(0, 30) : null,
        result.ConversationID || null, JSON.stringify(body), schoolId, originator,
      ]
    );
    if (r.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: null, action: 'b2b_result', tableName: 'mpesa_b2b_transactions', recordId: r.rows[0].id,
        details: { status, resultCode: result.ResultCode, transactionId: result.TransactionID || null },
      });
    }
    return r.rows[0] || null;
  });
}

/** A queue timeout does NOT mean the payment failed - the final result can still arrive later. */
async function applyB2BTimeout(schoolId, body) {
  const result = body && body.Result;
  const originator = result && result.OriginatorConversationID;
  if (!originator) return null;
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE mpesa_b2b_transactions
          SET status = 'timeout', result_desc = $3, raw_result = $4
        WHERE school_id = $1 AND originator_conversation_id = $2 AND status = 'pending'
        RETURNING *`,
      [schoolId, originator, (result.ResultDesc || 'The request timed out - check your M-Pesa statement before trying again').slice(0, 300), JSON.stringify(body)]
    );
    return r.rows[0] || null;
  });
}

async function listB2B(schoolId, { limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT b.id, b.command_id, b.party_a, b.party_b, b.account_reference, b.amount, b.remarks, b.status,
              b.transaction_id, b.result_desc, b.initiated_at, b.completed_at, u.full_name AS initiated_by_name
         FROM mpesa_b2b_transactions b LEFT JOIN users u ON u.id = b.initiated_by
        WHERE b.school_id = $1
        ORDER BY b.initiated_at DESC LIMIT $2 OFFSET $3`,
      [schoolId, limit, offset]
    );
    return r.rows;
  });
}

module.exports = {
  accountMatches, recordC2BPayment, listC2B, allocateManually, ignoreC2B,
  hasRecentDuplicateB2B, createB2B, applyB2BResult, applyB2BTimeout, listB2B,
};
