const { withTenantClient } = require('../config/db');

async function upsert(schoolId, { studentId, termId, classTeacherRemark, headTeacherRemark, generatedPdfUrl }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO report_cards (school_id, student_id, term_id, class_teacher_remark, head_teacher_remark, generated_pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (student_id, term_id)
       DO UPDATE SET class_teacher_remark = EXCLUDED.class_teacher_remark,
                     head_teacher_remark = EXCLUDED.head_teacher_remark,
                     generated_pdf_url = EXCLUDED.generated_pdf_url,
                     generated_at = now()
       RETURNING *`,
      [schoolId, studentId, termId, classTeacherRemark, headTeacherRemark, generatedPdfUrl]
    );
    return result.rows[0];
  });
}

async function getByStudentAndTerm(schoolId, studentId, termId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM report_cards WHERE student_id = $1 AND term_id = $2 AND school_id = $3`,
      [studentId, termId, schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Assembles everything a rendered report card needs in one round trip:
 * school identity, student + class/grade, the term's own dates (needed
 * for the attendance window), rubric results, an attendance summary over
 * that exact term, and any saved remarks. Built as one function rather
 * than making the PDF-rendering caller stitch together four separate
 * model calls itself — the bundle is the natural unit of "what a report
 * card is," and every consumer (PDF download, a future JSON preview, etc.)
 * needs the same shape.
 */
async function getBundle(schoolId, studentId, termId) {
  return withTenantClient(schoolId, async (client) => {
    const schoolResult = await client.query(`SELECT id, name, county, phone, email FROM schools WHERE id = $1`, [schoolId]);
    const school = schoolResult.rows[0];

    const studentResult = await client.query(
      `SELECT s.id, s.full_name, s.admission_number, s.gender, c.stream_name, g.name AS grade_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.current_class_id
       LEFT JOIN grades g ON g.id = c.grade_id
       WHERE s.id = $1 AND s.school_id = $2`,
      [studentId, schoolId]
    );
    const student = studentResult.rows[0];
    if (!student) return null;

    const termResult = await client.query(
      `SELECT t.id, t.term_number, t.start_date, t.end_date, ay.year_label
       FROM terms t
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.id = $1 AND ay.school_id = $2`,
      [termId, schoolId]
    );
    const term = termResult.rows[0];
    if (!term) return null;

    const resultsResult = await client.query(
      `SELECT DISTINCT ON (ss.id)
              la.name AS learning_area_name,
              st.name AS strand_name,
              ss.name AS sub_strand_name,
              rl.code AS rubric_code, rl.label AS rubric_label, rl.score_value,
              sar.teacher_remark
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

    const attendanceResult = await client.query(
      `SELECT status, COUNT(*) AS count FROM attendance_records
       WHERE student_id = $1 AND date BETWEEN $2 AND $3
       GROUP BY status`,
      [studentId, term.start_date, term.end_date]
    );
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    attendanceResult.rows.forEach((row) => { counts[row.status] = Number(row.count); });
    const totalDays = Object.values(counts).reduce((a, b) => a + b, 0);
    const attendance = {
      ...counts,
      total: totalDays,
      presentRatePercent: totalDays > 0 ? Math.round(((counts.present + counts.late) / totalDays) * 100) : null,
    };

    const reportCardResult = await client.query(
      `SELECT class_teacher_remark, head_teacher_remark FROM report_cards WHERE student_id = $1 AND term_id = $2`,
      [studentId, termId]
    );
    const remarks = reportCardResult.rows[0] || { class_teacher_remark: null, head_teacher_remark: null };

    return {
      school,
      student,
      term,
      results: resultsResult.rows,
      attendance,
      remarks,
    };
  });
}

module.exports = { upsert, getByStudentAndTerm, getBundle };