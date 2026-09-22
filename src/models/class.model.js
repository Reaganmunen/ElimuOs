const { withTenantClient } = require('../config/db');

async function create(schoolId, { gradeId, academicYearId, streamName, classTeacherId }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO classes (school_id, grade_id, academic_year_id, stream_name, class_teacher_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, gradeId, academicYearId, streamName, classTeacherId || null]
    );
    return result.rows[0];
  });
}

async function findById(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT c.*, g.name AS grade_name
       FROM classes c JOIN grades g ON g.id = c.grade_id
       WHERE c.id = $1`,
      [classId]
    );
    return result.rows[0] || null;
  });
}

async function listBySchool(schoolId, { academicYearId } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [];
    let yearFilter = '';
    if (academicYearId) {
      params.push(academicYearId);
      yearFilter = `AND c.academic_year_id = $${params.length}`;
    }
    const result = await client.query(
      `SELECT c.*, g.name AS grade_name,
              (SELECT COUNT(*) FROM students s WHERE s.current_class_id = c.id AND s.deleted_at IS NULL) AS student_count
       FROM classes c JOIN grades g ON g.id = c.grade_id
       WHERE 1=1 ${yearFilter}
       ORDER BY g.sort_order, c.stream_name`,
      params
    );
    return result.rows;
  });
}

/**
 * Resolves "is this user the class teacher (form teacher) of a class,
 * and which one" — distinct from teaching_assignments, which is about
 * which subjects a teacher teaches in which classes. A teacher can teach
 * several classes' subjects but be the class teacher of at most one
 * (class_teacher_id has no uniqueness constraint stopping more than one
 * class naming the same teacher, but in practice a school assigns one
 * class teacher per class per year — this returns all matches in the
 * rare case that isn't followed). Used by the "where do I land after
 * login" endpoint.
 */
async function listByClassTeacher(schoolId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT c.*, g.name AS grade_name
       FROM classes c JOIN grades g ON g.id = c.grade_id
       WHERE c.class_teacher_id = $1 AND c.school_id = $2
       ORDER BY c.created_at DESC`,
      [userId, schoolId]
    );
    return result.rows;
  });
}

async function update(schoolId, classId, { streamName, classTeacherId }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE classes SET stream_name = COALESCE($3, stream_name),
                           class_teacher_id = COALESCE($4, class_teacher_id)
       WHERE id = $1 AND school_id = $2 RETURNING *`,
      [classId, schoolId, streamName, classTeacherId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { create, findById, listBySchool, update, listByClassTeacher };
