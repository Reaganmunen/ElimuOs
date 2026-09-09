const { withTenantClient } = require('../config/db');

async function create(schoolId, { yearLabel, startDate, endDate }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO academic_years (school_id, year_label, start_date, end_date)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [schoolId, yearLabel, startDate, endDate]
    );
    return result.rows[0];
  });
}

async function setCurrent(schoolId, academicYearId) {
  return withTenantClient(schoolId, async (client) => {
    // Only one academic year should be "current" per school at a time.
    await client.query(`UPDATE academic_years SET is_current = false WHERE school_id = $1`, [schoolId]);
    const result = await client.query(
      `UPDATE academic_years SET is_current = true WHERE id = $1 AND school_id = $2 RETURNING *`,
      [academicYearId, schoolId]
    );
    return result.rows[0] || null;
  });
}

async function listBySchool(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM academic_years WHERE school_id = $1 ORDER BY start_date DESC`,
      [schoolId]
    );
    return result.rows;
  });
}

async function getCurrent(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1`,
      [schoolId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { create, setCurrent, listBySchool, getCurrent };
