const { withTenantClient } = require('../config/db');

async function createAssessment(schoolId, { classId, subStrandId, termId, teacherId, assessmentDate }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO assessments (school_id, class_id, sub_strand_id, term_id, teacher_id, assessment_date)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE))
       RETURNING *`,
      [schoolId, classId, subStrandId, termId, teacherId, assessmentDate || null]
    );
    return result.rows[0];
  });
}

async function getById(schoolId, assessmentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM assessments WHERE id = $1 AND school_id = $2`, [assessmentId, schoolId]);
    return result.rows[0] || null;
  });
}

/**
 * Bulk-records rubric results for every student in one assessment event.
 * `results` = [{ studentId, rubricLevelId, teacherRemark }]
 */
async function recordResults(schoolId, assessmentId, results) {
  return withTenantClient(schoolId, async (client) => {
    // Confirm the assessment actually belongs to this school before writing —
    // student_assessment_results has no direct school_id column, so this
    // check is the tenant boundary for this table.
    const check = await client.query(`SELECT id FROM assessments WHERE id = $1 AND school_id = $2`, [assessmentId, schoolId]);
    if (check.rows.length === 0) {
      throw new Error('Assessment not found in this school');
    }

    const saved = [];
    for (const r of results) {
      const result = await client.query(
        `INSERT INTO student_assessment_results (assessment_id, student_id, rubric_level_id, teacher_remark)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (assessment_id, student_id)
         DO UPDATE SET rubric_level_id = EXCLUDED.rubric_level_id, teacher_remark = EXCLUDED.teacher_remark
         RETURNING *`,
        [assessmentId, r.studentId, r.rubricLevelId, r.teacherRemark || null]
      );
      saved.push(result.rows[0]);
    }
    return saved;
  });
}

async function getResultsByAssessment(schoolId, assessmentId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT sar.*, s.full_name AS student_name, s.admission_number, rl.code AS rubric_code, rl.label AS rubric_label
       FROM student_assessment_results sar
       JOIN students s ON s.id = sar.student_id
       JOIN rubric_levels rl ON rl.id = sar.rubric_level_id
       JOIN assessments a ON a.id = sar.assessment_id
       WHERE sar.assessment_id = $1 AND a.school_id = $2
       ORDER BY s.full_name`,
      [assessmentId, schoolId]
    );
    return result.rows;
  });
}

/**
 * Aggregates every rubric result for one student in one term, grouped by
 * learning area > strand > sub-strand, for report card generation. Uses the
 * MOST RECENT result per sub-strand (not an average — CBC rubric levels
 * aren't meant to be numerically averaged the way marks are).
 */
async function getStudentTermResults(schoolId, studentId, termId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT DISTINCT ON (ss.id)
              la.name AS learning_area_name,
              st.name AS strand_name,
              ss.name AS sub_strand_name,
              rl.code AS rubric_code, rl.label AS rubric_label, rl.score_value,
              sar.teacher_remark, a.assessment_date
       FROM student_assessment_results sar
       JOIN assessments a ON a.id = sar.assessment_id
       JOIN sub_strands ss ON ss.id = a.sub_strand_id
       JOIN strands st ON st.id = ss.strand_id
       JOIN learning_areas la ON la.id = st.learning_area_id
       JOIN rubric_levels rl ON rl.id = sar.rubric_level_id
       WHERE sar.student_id = $1 AND a.term_id = $2 AND a.school_id = $3
       ORDER BY ss.id, a.assessment_date DESC`,
      [studentId, termId, schoolId]
    );
    return result.rows;
  });
}

module.exports = { createAssessment, getById, recordResults, getResultsByAssessment, getStudentTermResults };
