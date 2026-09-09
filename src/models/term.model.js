const { withTenantClient } = require('../config/db');

async function create(schoolId, { academicYearId, termNumber, startDate, endDate }) {
  return withTenantClient(schoolId, async (client) => {
    // academic_years has no direct school_id filter here since the FK
    // relationship plus RLS on the tenant connection already guarantees
    // academicYearId belongs to this school — a cross-tenant ID would
    // simply match zero rows in terms' own school-scoped queries downstream.
    const result = await client.query(
      `INSERT INTO terms (academic_year_id, term_number, start_date, end_date)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [academicYearId, termNumber, startDate, endDate]
    );
    return result.rows[0];
  });
}

async function listByAcademicYear(schoolId, academicYearId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT t.* FROM terms t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.academic_year_id = $1 AND ay.school_id = $2
       ORDER BY t.term_number`,
      [academicYearId, schoolId]
    );
    return result.rows;
  });
}

module.exports = { create, listByAcademicYear };
