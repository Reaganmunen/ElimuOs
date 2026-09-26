const { withTenantClient, query } = require('../config/db');

/**
 * Teacher-scoped reads/writes. Every function here is keyed off a class the
 * caller has ALREADY been authorised for (see teacherPortal.controller.js) —
 * "is this teacher the class teacher of it, or assigned to teach a subject in
 * it" is decided once, by getClassAccess, never re-derived per query.
 */

async function getClassAccess(schoolId, teacherId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const cls = await client.query(
      `SELECT id, grade_id, academic_year_id, class_teacher_id FROM classes WHERE id = $1 AND school_id = $2`,
      [classId, schoolId]
    );
    if (!cls.rows[0]) return null;
    const asg = await client.query(
      `SELECT learning_area_id FROM teaching_assignments
       WHERE class_id = $1 AND teacher_id = $2 AND school_id = $3 AND academic_year_id = $4`,
      [classId, teacherId, schoolId, cls.rows[0].academic_year_id]
    );
    return {
      cls: cls.rows[0],
      isClassTeacher: cls.rows[0].class_teacher_id != null && String(cls.rows[0].class_teacher_id) === String(teacherId),
      learningAreaIds: asg.rows.map((r) => String(r.learning_area_id)),
    };
  });
}

// Curriculum tables are global (no tenant), hence plain query().
async function resolveSubStrand(subStrandId) {
  const r = await query(
    `SELECT ss.id, la.id AS learning_area_id, la.grade_id
     FROM sub_strands ss JOIN strands st ON st.id = ss.strand_id JOIN learning_areas la ON la.id = st.learning_area_id
     WHERE ss.id = $1`,
    [subStrandId]
  );
  return r.rows[0] || null;
}

/** Subjects the teacher teaches + classes they are class teacher of, current academic year only. */
async function getOverview(schoolId, teacherId) {
  return withTenantClient(schoolId, async (client) => {
    const count = `(SELECT COUNT(*) FROM students s WHERE s.current_class_id = c.id AND s.deleted_at IS NULL)::int`;
    const subjects = await client.query(
      `SELECT ta.id, ta.class_id, ta.learning_area_id, ta.periods_per_week, la.name AS learning_area_name,
              c.stream_name, g.id AS grade_id, g.name AS grade_name, ${count} AS student_count
       FROM teaching_assignments ta
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN classes c ON c.id = ta.class_id
       JOIN grades g ON g.id = c.grade_id
       JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE ta.teacher_id = $1 AND ta.school_id = $2 AND ay.is_current
       ORDER BY g.sort_order, c.stream_name, la.name`,
      [teacherId, schoolId]
    );
    const homeroom = await client.query(
      `SELECT c.id AS class_id, c.stream_name, g.name AS grade_name, ay.year_label, ${count} AS student_count
       FROM classes c JOIN grades g ON g.id = c.grade_id JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE c.class_teacher_id = $1 AND c.school_id = $2 AND ay.is_current
       ORDER BY g.sort_order, c.stream_name`,
      [teacherId, schoolId]
    );
    return { subjects: subjects.rows, homeroom: homeroom.rows };
  });
}

/** Roster + each student's most recent result for one sub-strand this term (to pre-fill the grade entry grid). */
async function getGradeSheet(schoolId, { classId, subStrandId, termId }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT s.id AS student_id, s.full_name, s.admission_number,
              lr.rubric_level_id, lr.teacher_remark, lr.assessment_date
       FROM students s
       LEFT JOIN LATERAL (
         SELECT sar.rubric_level_id, sar.teacher_remark, a.assessment_date
         FROM student_assessment_results sar JOIN assessments a ON a.id = sar.assessment_id
         WHERE sar.student_id = s.id AND a.sub_strand_id = $2 AND a.term_id = $3 AND a.school_id = $4
         ORDER BY a.assessment_date DESC, a.id DESC LIMIT 1
       ) lr ON true
       WHERE s.current_class_id = $1 AND s.school_id = $4 AND s.deleted_at IS NULL
       ORDER BY s.full_name`,
      [classId, subStrandId, termId, schoolId]
    );
    return r.rows;
  });
}

/**
 * One assessment event = (class, sub-strand, term, teacher, date). Saving again the same
 * day edits that event; a different date creates a new one, so earlier grades stay as
 * history (report cards already take the most recent result per sub-strand).
 * Rejects students outside the class and term outside the class's academic year — the
 * generic POST /assessments/:id/results does neither.
 */
async function saveGrades(schoolId, teacherId, { classId, subStrandId, termId, assessmentDate, results }) {
  return withTenantClient(schoolId, async (client) => {
    const cls = (await client.query(`SELECT academic_year_id FROM classes WHERE id = $1 AND school_id = $2`, [classId, schoolId])).rows[0];
    const term = await client.query(
      `SELECT 1 FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.id = $1 AND ay.id = $2 AND ay.school_id = $3`,
      [termId, cls.academic_year_id, schoolId]
    );
    if (term.rows.length === 0) throw new Error("That term isn't in this class's academic year");

    const roster = new Set((await client.query(
      `SELECT id FROM students WHERE current_class_id = $1 AND school_id = $2 AND deleted_at IS NULL`, [classId, schoolId]
    )).rows.map((r) => String(r.id)));
    const levels = new Set((await client.query(`SELECT id FROM rubric_levels`)).rows.map((r) => String(r.id)));
    for (const r of results) {
      if (!roster.has(String(r.studentId))) throw new Error(`Student ${r.studentId} is not in this class`);
      if (!levels.has(String(r.rubricLevelId))) throw new Error('Unknown rubric level');
    }

    const date = assessmentDate || null;
    let assessment = (await client.query(
      `SELECT id FROM assessments
       WHERE school_id = $1 AND class_id = $2 AND sub_strand_id = $3 AND term_id = $4 AND teacher_id = $5
         AND assessment_date = COALESCE($6::date, CURRENT_DATE) LIMIT 1`,
      [schoolId, classId, subStrandId, termId, teacherId, date]
    )).rows[0];
    if (!assessment) {
      assessment = (await client.query(
        `INSERT INTO assessments (school_id, class_id, sub_strand_id, term_id, teacher_id, assessment_date)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE)) RETURNING id`,
        [schoolId, classId, subStrandId, termId, teacherId, date]
      )).rows[0];
    }

    for (const r of results) {
      await client.query(
        `INSERT INTO student_assessment_results (assessment_id, student_id, rubric_level_id, teacher_remark)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (assessment_id, student_id)
         DO UPDATE SET rubric_level_id = EXCLUDED.rubric_level_id, teacher_remark = EXCLUDED.teacher_remark`,
        [assessment.id, r.studentId, r.rubricLevelId, r.teacherRemark || null]
      );
    }
    return { assessmentId: assessment.id, saved: results.length };
  });
}

/**
 * Per-student performance for a term. Uses the most recent result per sub-strand (same rule
 * as report cards) and averages rubric score_value. Pass learningAreaId to scope it to one
 * subject (subject teacher view); omit for all subjects (class teacher view). Attendance is
 * counted over the term's own date window.
 */
async function getPerformance(schoolId, { classId, termId, learningAreaId }) {
  return withTenantClient(schoolId, async (client) => {
    const students = (await client.query(
      `SELECT id, full_name, admission_number, gender FROM students
       WHERE current_class_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY full_name`,
      [classId, schoolId]
    )).rows;

    const term = (await client.query(
      `SELECT t.start_date, t.end_date FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE t.id = $1 AND ay.school_id = $2`, [termId, schoolId]
    )).rows[0];
    if (!term) throw new Error('Term not found');

    const params = [schoolId, termId, classId];
    let areaFilter = '';
    if (learningAreaId) { params.push(learningAreaId); areaFilter = `AND la.id = $${params.length}`; }
    const results = (await client.query(
      `SELECT DISTINCT ON (sar.student_id, a.sub_strand_id)
              sar.student_id, la.id AS learning_area_id, la.name AS learning_area_name, rl.score_value
       FROM student_assessment_results sar
       JOIN assessments a ON a.id = sar.assessment_id
       JOIN sub_strands ss ON ss.id = a.sub_strand_id
       JOIN strands st ON st.id = ss.strand_id
       JOIN learning_areas la ON la.id = st.learning_area_id
       JOIN rubric_levels rl ON rl.id = sar.rubric_level_id
       WHERE a.school_id = $1 AND a.term_id = $2 ${areaFilter}
         AND sar.student_id IN (SELECT id FROM students WHERE current_class_id = $3 AND school_id = $1 AND deleted_at IS NULL)
       ORDER BY sar.student_id, a.sub_strand_id, a.assessment_date DESC, a.id DESC`,
      params
    )).rows;

    const att = (await client.query(
      `SELECT student_id, status, COUNT(*)::int AS n FROM attendance_records
       WHERE school_id = $1 AND date BETWEEN $2 AND $3
         AND student_id IN (SELECT id FROM students WHERE current_class_id = $4 AND school_id = $1 AND deleted_at IS NULL)
       GROUP BY student_id, status`,
      [schoolId, term.start_date, term.end_date, classId]
    )).rows;

    const round1 = (n) => Math.round(n * 10) / 10;
    return students.map((s) => {
      const mine = results.filter((r) => String(r.student_id) === String(s.id));
      const areas = new Map();
      mine.forEach((r) => {
        const a = areas.get(String(r.learning_area_id)) || { learning_area_id: r.learning_area_id, name: r.learning_area_name, sum: 0, count: 0 };
        a.sum += Number(r.score_value); a.count += 1;
        areas.set(String(r.learning_area_id), a);
      });
      const counts = { present: 0, absent: 0, late: 0, excused: 0 };
      att.filter((a) => String(a.student_id) === String(s.id)).forEach((a) => { counts[a.status] = a.n; });
      const total = Object.values(counts).reduce((x, y) => x + y, 0);
      return {
        student_id: s.id, full_name: s.full_name, admission_number: s.admission_number, gender: s.gender,
        assessed_count: mine.length,
        avg_score: mine.length ? round1(mine.reduce((x, r) => x + Number(r.score_value), 0) / mine.length) : null,
        by_area: [...areas.values()].map((a) => ({ learning_area_id: a.learning_area_id, name: a.name, avg_score: round1(a.sum / a.count), count: a.count })),
        attendance: { ...counts, total, rate_percent: total ? Math.round(((counts.present + counts.late) / total) * 100) : null },
      };
    });
  });
}

/** Guardians per student for one class. Deliberately omits national_id / portal user_id — a teacher needs contact details, not identity documents. */
async function getClassGuardians(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT s.id AS student_id, s.full_name, s.admission_number,
              COALESCE(json_agg(json_build_object(
                'id', g.id, 'full_name', g.full_name, 'phone', g.phone, 'email', g.email,
                'relationship', sg.relationship, 'is_primary_contact', sg.is_primary_contact
              ) ORDER BY sg.is_primary_contact DESC, g.full_name) FILTER (WHERE g.id IS NOT NULL), '[]') AS guardians
       FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id
       LEFT JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = $2
       WHERE s.current_class_id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL
       GROUP BY s.id ORDER BY s.full_name`,
      [classId, schoolId]
    );
    return r.rows;
  });
}

module.exports = { getClassAccess, resolveSubStrand, getOverview, getGradeSheet, saveGrades, getPerformance, getClassGuardians };
