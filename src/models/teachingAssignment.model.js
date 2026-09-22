const { withTenantClient } = require('../config/db');

async function create(schoolId, { classId, learningAreaId, teacherId, academicYearId, periodsPerWeek }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO teaching_assignments (school_id, class_id, learning_area_id, teacher_id, academic_year_id, periods_per_week)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (class_id, learning_area_id, academic_year_id)
       DO UPDATE SET teacher_id = EXCLUDED.teacher_id, periods_per_week = EXCLUDED.periods_per_week
       RETURNING *`,
      [schoolId, classId, learningAreaId, teacherId, academicYearId, periodsPerWeek || 5]
    );
    return result.rows[0];
  });
}

async function listByClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ta.*, la.name AS learning_area_name, u.full_name AS teacher_name
       FROM teaching_assignments ta
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.class_id = $1
       ORDER BY la.name`,
      [classId]
    );
    return result.rows;
  });
}

async function listByTeacher(schoolId, teacherId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ta.*, la.name AS learning_area_name, c.stream_name, g.name AS grade_name
       FROM teaching_assignments ta
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN classes c ON c.id = ta.class_id
       JOIN grades g ON g.id = c.grade_id
       WHERE ta.teacher_id = $1
       ORDER BY g.sort_order`,
      [teacherId]
    );
    return result.rows;
  });
}

async function remove(schoolId, assignmentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM teaching_assignments WHERE id = $1 AND school_id = $2 RETURNING id`,
      [assignmentId, schoolId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { create, listByClass, listByTeacher, remove };
