const { withTenantClient } = require('../config/db');

async function create(schoolId, { teachingAssignmentId, dayOfWeek, startTime, endTime }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO timetable_slots (school_id, teaching_assignment_id, day_of_week, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, teachingAssignmentId, dayOfWeek, startTime, endTime]
    );
    return result.rows[0];
  });
}

async function listByClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ts.*, la.name AS learning_area_name, u.full_name AS teacher_name
       FROM timetable_slots ts
       JOIN teaching_assignments ta ON ta.id = ts.teaching_assignment_id
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.class_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [classId]
    );
    return result.rows;
  });
}

async function listByTeacher(schoolId, teacherId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ts.*, la.name AS learning_area_name, c.stream_name, g.name AS grade_name
       FROM timetable_slots ts
       JOIN teaching_assignments ta ON ta.id = ts.teaching_assignment_id
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN classes c ON c.id = ta.class_id
       JOIN grades g ON g.id = c.grade_id
       WHERE ta.teacher_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [teacherId]
    );
    return result.rows;
  });
}

async function remove(schoolId, slotId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM timetable_slots WHERE id = $1 AND school_id = $2 RETURNING id`,
      [slotId, schoolId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { create, listByClass, listByTeacher, remove };
