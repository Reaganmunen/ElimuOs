const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

async function create(schoolId, { gradeId, termId, itemName, amount, isMandatory }, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO fee_structures (school_id, grade_id, term_id, item_name, amount, is_mandatory)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [schoolId, gradeId, termId, itemName, amount, isMandatory !== false]
    );
    const fee = result.rows[0];

    // Fee structure changes affect every future invoice generated for this
    // grade/term — worth a clear trail of who set the price and when.
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'create', tableName: 'fee_structures', recordId: fee.id,
      details: { gradeId, termId, itemName, amount },
    });

    return fee;
  });
}

async function listByGradeAndTerm(schoolId, gradeId, termId) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId, termId];
    let grade = '';
    if (gradeId) { params.push(gradeId); grade = ` AND f.grade_id = $${params.length}`; }
    const result = await client.query(
      `SELECT f.*, g.name AS grade_name FROM fee_structures f JOIN grades g ON g.id = f.grade_id
       WHERE f.school_id = $1 AND f.term_id = $2${grade} ORDER BY g.sort_order, f.item_name`,
      params
    );
    return result.rows;
  });
}

/** Copies fee items from one term to another (skipping any grade+item name already in the target). */
async function copyTerm(schoolId, { fromTermId, toTermId, gradeId }, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId, fromTermId, toTermId];
    let grade = '';
    if (gradeId) { params.push(gradeId); grade = ` AND f.grade_id = $${params.length}`; }
    const result = await client.query(
      `INSERT INTO fee_structures (school_id, grade_id, term_id, item_name, amount, is_mandatory)
       SELECT f.school_id, f.grade_id, $3, f.item_name, f.amount, f.is_mandatory FROM fee_structures f
       WHERE f.school_id = $1 AND f.term_id = $2${grade}
         AND NOT EXISTS (SELECT 1 FROM fee_structures x WHERE x.term_id = $3 AND x.grade_id = f.grade_id AND x.item_name = f.item_name)
       RETURNING id`,
      params
    );
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'create', tableName: 'fee_structures', recordId: null,
      details: { copiedFromTermId: fromTermId, toTermId, itemName: `${result.rowCount} item(s) copied` },
    });
    return { copied: result.rowCount };
  });
}

async function remove(schoolId, feeStructureId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM fee_structures WHERE id = $1 AND school_id = $2 RETURNING id, item_name, amount`,
      [feeStructureId, schoolId]
    );
    if (result.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'delete', tableName: 'fee_structures', recordId: feeStructureId,
        details: { itemName: result.rows[0].item_name, amount: result.rows[0].amount },
      });
    }
    return result.rows[0] || null;
  });
}

/**
 * Edits one fee item. Existing invoices are unaffected: invoice generation
 * copies each item's name/amount into invoice_items at that moment, so only
 * invoices generated AFTER this edit pick up the new figures. Both the old
 * and new values go in the audit trail, since this changes what gets billed.
 */
async function update(schoolId, feeStructureId, { itemName, amount, isMandatory }, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const before = await client.query(
      `SELECT item_name, amount, is_mandatory FROM fee_structures WHERE id = $1 AND school_id = $2`,
      [feeStructureId, schoolId]
    );
    if (before.rows.length === 0) return null;

    const result = await client.query(
      `UPDATE fee_structures
       SET item_name = COALESCE($3, item_name), amount = COALESCE($4, amount), is_mandatory = COALESCE($5, is_mandatory)
       WHERE id = $1 AND school_id = $2 RETURNING *`,
      [feeStructureId, schoolId, itemName ?? null, amount ?? null, isMandatory ?? null]
    );
    const fee = result.rows[0];
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'update', tableName: 'fee_structures', recordId: feeStructureId,
      details: {
        from: { itemName: before.rows[0].item_name, amount: before.rows[0].amount, isMandatory: before.rows[0].is_mandatory },
        to: { itemName: fee.item_name, amount: fee.amount, isMandatory: fee.is_mandatory },
      },
    });
    return fee;
  });
}

module.exports = { create, listByGradeAndTerm, copyTerm, update, remove };