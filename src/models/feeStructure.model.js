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
    const result = await client.query(
      `SELECT * FROM fee_structures WHERE grade_id = $1 AND term_id = $2 ORDER BY item_name`,
      [gradeId, termId]
    );
    return result.rows;
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

module.exports = { create, listByGradeAndTerm, remove };