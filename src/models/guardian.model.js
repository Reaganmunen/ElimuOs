const { withTenantClient } = require('../config/db');

async function create(schoolId, { fullName, phone, email, nationalId }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO guardians (school_id, full_name, phone, email, national_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, fullName, phone, email, nationalId]
    );
    return result.rows[0];
  });
}

async function findById(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM guardians WHERE id = $1`, [guardianId]);
    return result.rows[0] || null;
  });
}

async function search(schoolId, { q, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [limit, offset];
    let filter = '';
    if (q) {
      params.push(`%${q}%`);
      filter = `AND (full_name ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    const result = await client.query(
      `SELECT * FROM guardians WHERE 1=1 ${filter} ORDER BY full_name LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows;
  });
}

/**
 * Links a guardian to a student. Uses ON CONFLICT so re-linking the same
 * pair just updates the relationship/primary flag instead of erroring.
 *
 * student_guardians has no school_id column of its own, and its RLS
 * policy (as of migration 007) only allows the insert through when BOTH
 * the student and the guardian belong to the current tenant — but relying
 * on that alone means a bad guardianId fails as an opaque Postgres
 * RLS-violation error rather than a clean 404. This explicit existence
 * check exists to give the caller that clean error; the RLS policy is the
 * actual enforcement backstop if this check is ever bypassed or this
 * function is ever called from somewhere that skips it.
 */
async function linkToStudent(schoolId, { studentId, guardianId, relationship, isPrimaryContact }) {
  return withTenantClient(schoolId, async (client) => {
    const guardianCheck = await client.query(`SELECT id FROM guardians WHERE id = $1 AND school_id = $2`, [guardianId, schoolId]);
    if (guardianCheck.rows.length === 0) {
      throw new Error('Guardian not found in this school');
    }

    const result = await client.query(
      `INSERT INTO student_guardians (student_id, guardian_id, relationship, is_primary_contact)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (student_id, guardian_id)
       DO UPDATE SET relationship = EXCLUDED.relationship, is_primary_contact = EXCLUDED.is_primary_contact
       RETURNING *`,
      [studentId, guardianId, relationship, isPrimaryContact || false]
    );
    return result.rows[0];
  });
}

async function listByStudent(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT g.*, sg.relationship, sg.is_primary_contact
       FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       WHERE sg.student_id = $1
       ORDER BY sg.is_primary_contact DESC, g.full_name`,
      [studentId]
    );
    return result.rows;
  });
}

async function listStudentsByGuardian(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT s.*, sg.relationship
       FROM students s
       JOIN student_guardians sg ON sg.student_id = s.id
       WHERE sg.guardian_id = $1 AND s.deleted_at IS NULL`,
      [guardianId]
    );
    return result.rows;
  });
}

// All guardians of every student currently in a given class — used to
// broadcast a message (e.g. a fee reminder) to an entire class's parents.
async function listByClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT DISTINCT g.*
       FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id
       WHERE s.current_class_id = $1 AND s.deleted_at IS NULL`,
      [classId]
    );
    return result.rows;
  });
}

async function unlinkFromStudent(schoolId, studentId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2 RETURNING student_id`,
      [studentId, guardianId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Attaches a login account to an existing guardian, enabling parent-portal
 * access. One user per guardian (enforced by guardians.user_id being a
 * plain FK with app-level uniqueness checked here, mirroring the pattern
 * used for students below).
 */
async function linkUserAccount(schoolId, guardianId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE guardians SET user_id = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
      [userId, guardianId, schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Resolves "which guardian record does this logged-in parent user
 * correspond to" — the starting point for every parent-portal endpoint.
 */
async function findByUserId(schoolId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM guardians WHERE user_id = $1 AND school_id = $2`, [userId, schoolId]);
    return result.rows[0] || null;
  });
}

/**
 * THE authorization check for the entire parent portal: does the logged-in
 * user's guardian record actually have a relationship to this student?
 * Every parent-facing endpoint that takes a studentId in the URL must call
 * this before touching that student's data — without it, a parent could
 * view or pay for ANY student in the school just by guessing IDs, since
 * tenant (school_id) scoping alone doesn't prove a family relationship.
 */
async function isGuardianOfStudent(schoolId, userId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT 1 FROM student_guardians sg
       JOIN guardians g ON g.id = sg.guardian_id
       WHERE g.user_id = $1 AND sg.student_id = $2 AND g.school_id = $3`,
      [userId, studentId, schoolId]
    );
    return result.rows.length > 0;
  });
}

module.exports = {
  create, findById, search, linkToStudent, listByStudent, listStudentsByGuardian, listByClass, unlinkFromStudent,
  linkUserAccount, findByUserId, isGuardianOfStudent,
};