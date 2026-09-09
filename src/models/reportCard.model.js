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

module.exports = { upsert, getByStudentAndTerm };
