const { withTenantClient } = require('../config/db');

/**
 * An explicit existence check here (rather than trusting the terms RLS
 * policy alone to reject a cross-tenant academicYearId) is deliberate:
 * the terms table has no direct school_id column, so its RLS policy is
 * "academic_year_id IN (SELECT id FROM academic_years WHERE school_id =
 * current tenant)". Without an explicit WITH CHECK, Postgres reuses that
 * same USING expression for INSERT, so a cross-tenant academicYearId IS
 * correctly rejected at the database level — but as a raw
 * new-row-violates-row-level-security-policy error, which would bubble up
 * through withTenantClient as an unhandled exception and surface to the
 * client as a generic 500 rather than a clean 400. This check turns that
 * into the same kind of expected, clearly-worded error every other model
 * in this codebase throws for a bad foreign id.
 */
async function create(schoolId, { academicYearId, termNumber, startDate, endDate }) {
  return withTenantClient(schoolId, async (client) => {
    const yearCheck = await client.query(`SELECT id FROM academic_years WHERE id = $1 AND school_id = $2`, [academicYearId, schoolId]);
    if (yearCheck.rows.length === 0) {
      throw new Error('Academic year not found in this school');
    }

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
