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

// Links a guardian to a student. Uses ON CONFLICT so re-linking the same
// pair just updates the relationship/primary flag instead of erroring.
async function linkToStudent(schoolId, { studentId, guardianId, relationship, isPrimaryContact }) {
  return withTenantClient(schoolId, async (client) => {
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

module.exports = {
  create, findById, search, linkToStudent, listByStudent, listStudentsByGuardian, listByClass, unlinkFromStudent,
};
