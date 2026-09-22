const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

async function create(schoolId, {
  admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId,
}, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO students (school_id, admission_number, full_name, date_of_birth, gender, upi_number, current_class_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [schoolId, admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId]
    );
    const student = result.rows[0];

    // Record this year's class in the history table so promotions/repeats
    // don't erase where the student sat in a prior year.
    if (currentClassId) {
      const classRow = await client.query(`SELECT academic_year_id FROM classes WHERE id = $1`, [currentClassId]);
      if (classRow.rows[0]) {
        await client.query(
          `INSERT INTO student_class_history (student_id, class_id, school_id, academic_year_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id`,
          [student.id, currentClassId, schoolId, classRow.rows[0].academic_year_id]
        );
      }
    }

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'create', tableName: 'students', recordId: student.id,
      details: { admissionNumber, fullName },
    });

    return student;
  });
}

async function findById(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT s.*, c.stream_name, g.name AS grade_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN grades g ON g.id = c.grade_id
       WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [studentId]
    );
    return result.rows[0] || null;
  });
}

async function listByClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM students
       WHERE current_class_id = $1 AND deleted_at IS NULL
       ORDER BY full_name`,
      [classId]
    );
    return result.rows;
  });
}

async function search(schoolId, { q, status, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [limit, offset];
    let filter = '';
    if (q) {
      params.push(`%${q}%`);
      filter += ` AND (full_name ILIKE $${params.length} OR admission_number ILIKE $${params.length})`;
    }
    if (status) {
      params.push(status);
      filter += ` AND status = $${params.length}`;
    }
    const result = await client.query(
      `SELECT * FROM students
       WHERE deleted_at IS NULL ${filter}
       ORDER BY full_name
       LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows;
  });
}

async function update(schoolId, studentId, fields, actorUserId) {
  const allowed = ['full_name', 'date_of_birth', 'gender', 'upi_number', 'status', 'photo_url'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(schoolId, studentId);

  return withTenantClient(schoolId, async (client) => {
    const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = keys.map((k) => fields[k]);
    const result = await client.query(
      `UPDATE students SET ${setClause} WHERE id = $1 AND school_id = $2 RETURNING *`,
      [studentId, schoolId, ...values]
    );
    if (result.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'update', tableName: 'students', recordId: studentId,
        details: { changedFields: keys },
      });
    }
    return result.rows[0] || null;
  });
}

/**
 * Moves a student to a new class — used for promotions or mid-year
 * transfers between streams. Also stamps student_class_history for the
 * destination class's academic year.
 */
async function transferClass(schoolId, studentId, newClassId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const classRow = await client.query(`SELECT academic_year_id FROM classes WHERE id = $1 AND school_id = $2`, [newClassId, schoolId]);
    if (classRow.rows.length === 0) {
      throw new Error('Target class not found in this school');
    }
    const result = await client.query(
      `UPDATE students SET current_class_id = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
      [newClassId, studentId, schoolId]
    );
    await client.query(
      `INSERT INTO student_class_history (student_id, class_id, school_id, academic_year_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (student_id, academic_year_id) DO UPDATE SET class_id = EXCLUDED.class_id`,
      [studentId, newClassId, schoolId, classRow.rows[0].academic_year_id]
    );

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'transfer_class', tableName: 'students', recordId: studentId,
      details: { newClassId },
    });

    return result.rows[0] || null;
  });
}

async function softDelete(schoolId, studentId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE students SET deleted_at = now(), status = 'withdrawn' WHERE id = $1 AND school_id = $2 RETURNING id`,
      [studentId, schoolId]
    );
    if (result.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'withdraw', tableName: 'students', recordId: studentId,
      });
    }
    return result.rows[0] || null;
  });
}

/**
 * Attaches a login account to an existing student, enabling student-portal
 * access. Most students won't have one — this is opt-in per student,
 * typically set up for older learners (Junior School and up).
 */
async function linkUserAccount(schoolId, studentId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE students SET user_id = $1 WHERE id = $2 AND school_id = $3 RETURNING *`,
      [userId, studentId, schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Resolves "which student record does this logged-in student user
 * correspond to" — the starting point for every student-portal endpoint.
 * No separate ownership check is needed beyond this (unlike the parent
 * portal's isGuardianOfStudent) because a student portal account only
 * ever represents itself, never a set of other people's records.
 */
async function findByUserId(schoolId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT s.*, c.stream_name, g.name AS grade_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN grades g ON g.id = c.grade_id
       WHERE s.user_id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL`,
      [userId, schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Count of currently-enrolled (not withdrawn/deleted) students — used to
 * enforce a subscription plan's max_students seat limit, e.g. when a
 * school tries to downgrade to a smaller plan (see billing.controller.js
 * changeMyPlan).
 */
async function countActive(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT COUNT(*) AS count FROM students WHERE school_id = $1 AND deleted_at IS NULL`,
      [schoolId]
    );
    return Number(result.rows[0].count);
  });
}

module.exports = {
  create, findById, listByClass, search, update, transferClass, softDelete, linkUserAccount, findByUserId, countActive,
};