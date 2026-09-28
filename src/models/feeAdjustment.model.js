const { withTenantClient } = require('../config/db');
const invoiceModel = require('./invoice.model');
const { recordAudit } = require('../utils/auditLog.util');

const KINDS = { discount: 'Discount', bursary: 'Bursary' };
const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be a number greater than 0');
  return Math.round(n * 100) / 100;
};
const cleanReason = (r) => {
  const t = typeof r === 'string' ? r.trim().slice(0, 200) : '';
  if (t.length < 3) throw new Error('A reason is required');
  return t;
};
const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

async function lockInvoice(client, schoolId, invoiceId) {
  const r = await client.query(
    `SELECT id, student_id, total_amount, amount_paid FROM invoices WHERE id = $1 AND school_id = $2 FOR UPDATE`,
    [invoiceId, schoolId]
  );
  if (!r.rows[0]) throw new Error('Invoice not found');
  return r.rows[0];
}

/** Adds one line to an invoice (sign -1 reduces it, +1 increases it) and records the adjustment. */
async function addLine(client, schoolId, inv, { kind, description, amount, sign, relatedInvoiceId, reason, actor }) {
  const item = await client.query(
    `INSERT INTO invoice_items (invoice_id, fee_structure_id, description, amount) VALUES ($1, NULL, $2, $3) RETURNING id`,
    [inv.id, description.slice(0, 150), sign * amount]
  );
  await client.query(`UPDATE invoices SET total_amount = total_amount + $2 WHERE id = $1`, [inv.id, sign * amount]);
  const adj = await client.query(
    `INSERT INTO fee_adjustments (school_id, invoice_id, student_id, kind, description, amount, invoice_item_id, related_invoice_id, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [schoolId, inv.id, inv.student_id, kind, description.slice(0, 150), amount, item.rows[0].id, relatedInvoiceId || null, reason || null, actor]
  );
  return adj.rows[0];
}

/** Discount or bursary on one invoice. May exceed the balance (creating a credit) but never the invoice total. */
async function apply(schoolId, { invoiceId, kind, amount, reason }, actor) {
  if (!KINDS[kind]) throw new Error('kind must be discount or bursary');
  const amt = money(amount);
  const why = cleanReason(reason);
  return withTenantClient(schoolId, async (client) => {
    const inv = await lockInvoice(client, schoolId, invoiceId);
    if (amt > Number(inv.total_amount) + 0.005) throw new Error(`Adjustment cannot exceed the invoice total of ${kes(inv.total_amount)}`);
    const adjustment = await addLine(client, schoolId, inv, { kind, description: `${KINDS[kind]}: ${why}`, amount: amt, sign: -1, reason: why, actor });
    const invoice = await invoiceModel.recalculateStatus(client, inv.id);
    await recordAudit(client, {
      schoolId, userId: actor, action: 'adjust', tableName: 'invoices', recordId: inv.id,
      details: { kind, amount: amt, reason: why },
    });
    return { adjustment, invoice };
  });
}

/** Undo a discount/bursary. Carried-forward arrears are not reversible here (they touch two invoices). */
async function reverse(schoolId, adjustmentId, actor, reason) {
  const why = cleanReason(reason);
  return withTenantClient(schoolId, async (client) => {
    const found = await client.query(
      `SELECT * FROM fee_adjustments WHERE id = $1 AND school_id = $2 AND reversed_at IS NULL AND kind IN ('discount','bursary') FOR UPDATE`,
      [adjustmentId, schoolId]
    );
    const adj = found.rows[0];
    if (!adj) throw new Error('Adjustment not found, already reversed, or not reversible');
    const inv = await lockInvoice(client, schoolId, adj.invoice_id);
    if (adj.invoice_item_id) await client.query(`DELETE FROM invoice_items WHERE id = $1`, [adj.invoice_item_id]);
    await client.query(`UPDATE invoices SET total_amount = total_amount + $2 WHERE id = $1`, [inv.id, adj.amount]);
    await client.query(`UPDATE fee_adjustments SET reversed_at = now(), reversed_by = $2, reverse_reason = $3 WHERE id = $1`, [adj.id, actor, why]);
    const invoice = await invoiceModel.recalculateStatus(client, inv.id);
    await recordAudit(client, {
      schoolId, userId: actor, action: 'reverse_adjustment', tableName: 'invoices', recordId: inv.id,
      details: { kind: adj.kind, amount: adj.amount, reason: why },
    });
    return { invoice };
  });
}

/**
 * Moves unpaid balances from fromTerm's invoices onto the same student's invoice in toTerm.
 * The old invoice gets a negative "carried forward" line (so it closes at zero balance) and the
 * new one a positive "arrears b/f" line — net billed across the school is unchanged. Students
 * with no invoice in the later term are skipped and counted.
 */
async function carryForward(schoolId, { fromTermId, toTermId, classId, studentId }, actor) {
  if (!fromTermId || !toTermId || String(fromTermId) === String(toTermId)) throw new Error('Choose two different terms');
  return withTenantClient(schoolId, async (client) => {
    const terms = await client.query(`SELECT id, term_number, start_date FROM terms WHERE id = ANY($1::bigint[])`, [[fromTermId, toTermId]]);
    const from = terms.rows.find((t) => String(t.id) === String(fromTermId));
    const to = terms.rows.find((t) => String(t.id) === String(toTermId));
    if (!from || !to) throw new Error('Term not found');
    if (new Date(from.start_date) >= new Date(to.start_date)) throw new Error('Arrears can only be carried forward to a later term');

    const params = [schoolId, fromTermId, toTermId];
    let extra = '';
    if (classId) { params.push(classId); extra += ` AND s.current_class_id = $${params.length}`; }
    if (studentId) { params.push(studentId); extra += ` AND a.student_id = $${params.length}`; }
    const base = `FROM invoices a JOIN students s ON s.id = a.student_id
                  WHERE a.school_id = $1 AND a.term_id = $2 AND a.total_amount - a.amount_paid > 0.005${extra}`;

    const skipped = await client.query(
      `SELECT COUNT(*)::int AS n ${base} AND NOT EXISTS (SELECT 1 FROM invoices b WHERE b.student_id = a.student_id AND b.term_id = $3)`, params
    );
    const pairs = await client.query(
      `SELECT a.id AS from_id, a.student_id,
              (SELECT b.id FROM invoices b WHERE b.student_id = a.student_id AND b.term_id = $3) AS to_id
       ${base} AND EXISTS (SELECT 1 FROM invoices b WHERE b.student_id = a.student_id AND b.term_id = $3)`,
      params
    );

    let carried = 0;
    let amount = 0;
    for (const p of pairs.rows) {
      const locked = await client.query(
        `SELECT id, student_id, total_amount, amount_paid FROM invoices WHERE id = ANY($1::bigint[]) AND school_id = $2 ORDER BY id FOR UPDATE`,
        [[p.from_id, p.to_id], schoolId]
      );
      const src = locked.rows.find((r) => String(r.id) === String(p.from_id));
      const dst = locked.rows.find((r) => String(r.id) === String(p.to_id));
      const bal = Math.round((Number(src.total_amount) - Number(src.amount_paid || 0)) * 100) / 100;
      if (bal <= 0.005) continue; // eslint-disable-line no-continue
      await addLine(client, schoolId, src, { kind: 'arrears_out', description: `Carried forward to Term ${to.term_number}`, amount: bal, sign: -1, relatedInvoiceId: dst.id, actor });
      await addLine(client, schoolId, dst, { kind: 'arrears_in', description: `Arrears b/f from Term ${from.term_number}`, amount: bal, sign: 1, relatedInvoiceId: src.id, actor });
      await invoiceModel.recalculateStatus(client, src.id);
      await invoiceModel.recalculateStatus(client, dst.id);
      await recordAudit(client, {
        schoolId, userId: actor, action: 'carry_forward', tableName: 'invoices', recordId: src.id,
        details: { amount: bal, toInvoiceId: dst.id, fromTermId, toTermId },
      });
      carried += 1;
      amount += bal;
    }
    return { carried, amount, skippedNoInvoice: skipped.rows[0].n };
  });
}

async function listForInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT id, kind, description, amount, reason, invoice_item_id, created_at FROM fee_adjustments WHERE invoice_id = $1 AND reversed_at IS NULL ORDER BY id`,
    [invoiceId]
  );
  return r.rows;
}

module.exports = { apply, reverse, carryForward, listForInvoice };