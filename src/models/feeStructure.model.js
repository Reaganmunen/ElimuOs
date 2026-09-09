const { withTenantClient } = require('../config/db');

async function create(schoolId, { gradeId, termId, itemName, amount, isMandatory }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO fee_structures (school_id, grade_id, term_id, item_name, amount, is_mandatory)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [schoolId, gradeId, termId, itemName, amount, isMandatory !== false]
    );
    return result.rows[0];
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

async function remove(schoolId, feeStructureId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM fee_structures WHERE id = $1 AND school_id = $2 RETURNING id`,
      [feeStructureId, schoolId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { create, listByGradeAndTerm, remove };
