const { withTenantClient } = require('../config/db');

/**
 * Queries that only the guardian (parent) portal and its staff-side
 * counterparts need. Every function is tenant-scoped through
 * withTenantClient; ownership of a student / guardian is enforced by the
 * callers (parentPortal.routes.js router.param + controller lookups).
 */

// ---------- Terms ----------
async function currentTerm(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT t.*, ay.year_label
       FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE ay.school_id = $1
       ORDER BY (CURRENT_DATE BETWEEN t.start_date AND t.end_date) DESC,
                (t.start_date <= CURRENT_DATE) DESC, t.start_date DESC
       LIMIT 1`,
      [schoolId]
    );
    return r.rows[0] || null;
  });
}

// ---------- Guardian profile ----------
async function updateContact(schoolId, guardianId, { phone, email }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE guardians SET phone = COALESCE($1, phone), email = $2
       WHERE id = $3 AND school_id = $4 RETURNING *`,
      [phone || null, email || null, guardianId, schoolId]
    );
    return r.rows[0] || null;
  });
}

// ---------- Inbox (school broadcasts sent to this guardian) ----------
async function listInbox(schoolId, guardianId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT m.id, m.channel, m.subject, m.body, COALESCE(m.sent_at, m.created_at) AS sent_at,
              mr.read_at, u.full_name AS sender_name
       FROM message_recipients mr
       JOIN messages m ON m.id = mr.message_id
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE mr.guardian_id = $1 AND m.school_id = $2 AND mr.delivery_status = 'delivered'
         ${unreadOnly ? 'AND mr.read_at IS NULL' : ''}
       ORDER BY COALESCE(m.sent_at, m.created_at) DESC
       LIMIT $3 OFFSET $4`,
      [guardianId, schoolId, limit, offset]
    );
    return r.rows;
  });
}

async function unreadCount(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM message_recipients mr JOIN messages m ON m.id = mr.message_id
       WHERE mr.guardian_id = $1 AND m.school_id = $2 AND mr.delivery_status = 'delivered' AND mr.read_at IS NULL`,
      [guardianId, schoolId]
    );
    return r.rows[0].n;
  });
}

async function markRead(schoolId, guardianId, messageId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE message_recipients mr SET read_at = COALESCE(mr.read_at, now())
       FROM messages m
       WHERE m.id = mr.message_id AND m.school_id = $3 AND mr.message_id = $1 AND mr.guardian_id = $2
       RETURNING mr.message_id`,
      [messageId, guardianId, schoolId]
    );
    return r.rows[0] || null;
  });
}

async function markAllRead(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE message_recipients mr SET read_at = now()
       FROM messages m
       WHERE m.id = mr.message_id AND m.school_id = $2 AND mr.guardian_id = $1 AND mr.read_at IS NULL`,
      [guardianId, schoolId]
    );
    return r.rowCount;
  });
}

// ---------- Child: teachers, payments ----------
async function listTeachersForClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const cls = await client.query(
      `SELECT u.full_name FROM classes c JOIN users u ON u.id = c.class_teacher_id WHERE c.id = $1`,
      [classId]
    );
    const subjects = await client.query(
      `SELECT DISTINCT la.name AS learning_area_name, u.full_name AS teacher_name
       FROM teaching_assignments ta
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.class_id = $1
       ORDER BY la.name`,
      [classId]
    );
    return { classTeacher: cls.rows[0] ? cls.rows[0].full_name : null, subjectTeachers: subjects.rows };
  });
}

async function listPaymentsByStudent(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.mpesa_receipt_number, p.reference_note, p.paid_at,
              t.term_number, ay.year_label
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN terms t ON t.id = i.term_id
       JOIN academic_years ay ON ay.id = t.academic_year_id
       WHERE p.student_id = $1 AND p.school_id = $2 AND p.deleted_at IS NULL
       ORDER BY p.paid_at DESC`,
      [studentId, schoolId]
    );
    return r.rows;
  });
}

// ---------- Absence reports ----------
async function createAbsenceReport(schoolId, { studentId, guardianId, reportType, dateFrom, dateTo, expectedTime, reason }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `INSERT INTO absence_reports (school_id, student_id, guardian_id, report_type, date_from, date_to, expected_time, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [schoolId, studentId, guardianId, reportType, dateFrom, dateTo, expectedTime || null, reason]
    );
    return r.rows[0];
  });
}

async function listAbsenceReportsByStudent(schoolId, studentId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT ar.*, g.full_name AS guardian_name
       FROM absence_reports ar JOIN guardians g ON g.id = ar.guardian_id
       WHERE ar.student_id = $1 AND ar.school_id = $2
       ORDER BY ar.date_from DESC, ar.created_at DESC LIMIT 100`,
      [studentId, schoolId]
    );
    return r.rows;
  });
}

// A guardian can only withdraw a report that staff haven't acknowledged yet.
async function cancelAbsenceReport(schoolId, { reportId, studentId }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE absence_reports SET status = 'cancelled'
       WHERE id = $1 AND student_id = $2 AND school_id = $3 AND status = 'submitted' RETURNING *`,
      [reportId, studentId, schoolId]
    );
    return r.rows[0] || null;
  });
}

// Class-teacher scope: a teacher only handles notices for students in classes they are class teacher of.
const TEACHER_STUDENT_SCOPE = (n) =>
  `s.current_class_id IN (SELECT c.id FROM classes c WHERE c.class_teacher_id = $${n} AND c.school_id = $1)`;

async function listAbsenceReportsForStaff(schoolId, { date, status, classId, teacherId, limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    const where = ['ar.school_id = $1', "ar.status <> 'cancelled'"];
    if (date) { params.push(date); where.push(`ar.date_from <= $${params.length} AND ar.date_to >= $${params.length}`); }
    if (status) { params.push(status); where.push(`ar.status = $${params.length}`); }
    if (classId) { params.push(classId); where.push(`s.current_class_id = $${params.length}`); }
    if (teacherId) { params.push(teacherId); where.push(TEACHER_STUDENT_SCOPE(params.length)); }
    params.push(limit, offset);
    const r = await client.query(
      `SELECT ar.*, s.full_name AS student_name, s.admission_number, g.full_name AS guardian_name, g.phone AS guardian_phone,
              gr.name AS grade_name, cl.stream_name, ack.full_name AS acknowledged_by_name
       FROM absence_reports ar
       JOIN students s ON s.id = ar.student_id
       JOIN guardians g ON g.id = ar.guardian_id
       LEFT JOIN classes cl ON cl.id = s.current_class_id
       LEFT JOIN grades gr ON gr.id = cl.grade_id
       LEFT JOIN users ack ON ack.id = ar.acknowledged_by
       WHERE ${where.join(' AND ')}
       ORDER BY ar.date_from DESC, ar.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  });
}

async function acknowledgeAbsenceReport(schoolId, { reportId, userId, staffNote, teacherId = null }) {
  return withTenantClient(schoolId, async (client) => {
    // teacherId set → the caller is a teacher; only their own class's students qualify.
    const r = await client.query(
      `UPDATE absence_reports ar
       SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now(), staff_note = $2
       WHERE ar.id = $3 AND ar.school_id = $4 AND ar.status = 'submitted'
         AND ($5::bigint IS NULL OR EXISTS (
           SELECT 1 FROM students s JOIN classes c ON c.id = s.current_class_id
           WHERE s.id = ar.student_id AND c.class_teacher_id = $5 AND c.school_id = $4))
       RETURNING ar.*`,
      [userId, staffNote || null, reportId, schoolId, teacherId]
    );
    return r.rows[0] || null;
  });
}

// ---------- Enquiries ----------
async function createEnquiry(schoolId, { guardianId, studentId, subject, body }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `INSERT INTO guardian_enquiries (school_id, guardian_id, student_id, subject, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, guardianId, studentId || null, subject, body]
    );
    return r.rows[0];
  });
}

async function listEnquiriesByGuardian(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT e.*, s.full_name AS student_name, u.full_name AS replied_by_name
       FROM guardian_enquiries e
       LEFT JOIN students s ON s.id = e.student_id
       LEFT JOIN users u ON u.id = e.replied_by
       WHERE e.guardian_id = $1 AND e.school_id = $2
       ORDER BY e.created_at DESC LIMIT 100`,
      [guardianId, schoolId]
    );
    return r.rows;
  });
}

async function markEnquiryReplySeen(schoolId, guardianId, enquiryId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE guardian_enquiries SET reply_seen_at = COALESCE(reply_seen_at, now())
       WHERE id = $1 AND guardian_id = $2 AND school_id = $3 RETURNING id`,
      [enquiryId, guardianId, schoolId]
    );
    return r.rows[0] || null;
  });
}

async function unseenReplyCount(schoolId, guardianId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `SELECT COUNT(*)::int AS n FROM guardian_enquiries
       WHERE guardian_id = $1 AND school_id = $2 AND reply IS NOT NULL AND reply_seen_at IS NULL`,
      [guardianId, schoolId]
    );
    return r.rows[0].n;
  });
}

const ENQUIRY_SELECT = `
  SELECT e.*, g.full_name AS guardian_name, g.phone AS guardian_phone, g.email AS guardian_email,
         s.full_name AS student_name, s.admission_number, gr.name AS grade_name, cl.stream_name,
         at.full_name AS assigned_to_name, fb.full_name AS forwarded_by_name, rb.full_name AS replied_by_name
  FROM guardian_enquiries e
  JOIN guardians g ON g.id = e.guardian_id
  LEFT JOIN students s ON s.id = e.student_id
  LEFT JOIN classes cl ON cl.id = s.current_class_id
  LEFT JOIN grades gr ON gr.id = cl.grade_id
  LEFT JOIN users at ON at.id = e.assigned_to
  LEFT JOIN users fb ON fb.id = e.forwarded_by
  LEFT JOIN users rb ON rb.id = e.replied_by`;

// assignedTo set → teacher view: only enquiries forwarded to that teacher.
// assigned = 'unassigned' | 'forwarded' (admin filters).
async function listEnquiriesForStaff(schoolId, { status, assignedTo, assigned, limit = 100, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId];
    const where = ['e.school_id = $1'];
    if (status) { params.push(status); where.push(`e.status = $${params.length}`); }
    if (assignedTo) { params.push(assignedTo); where.push(`e.assigned_to = $${params.length}`); }
    if (assigned === 'unassigned') where.push('e.assigned_to IS NULL');
    if (assigned === 'forwarded') where.push('e.assigned_to IS NOT NULL');
    params.push(limit, offset);
    const r = await client.query(
      `${ENQUIRY_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY (e.status = 'open') DESC, e.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  });
}

async function getEnquiryForStaff(schoolId, enquiryId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(`${ENQUIRY_SELECT} WHERE e.school_id = $1 AND e.id = $2`, [schoolId, enquiryId]);
    return r.rows[0] || null;
  });
}

// assignedTo set → the caller is a teacher and may only answer enquiries forwarded to them.
async function replyToEnquiry(schoolId, { enquiryId, userId, reply, assignedTo = null }) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE guardian_enquiries
       SET reply = $1, replied_by = $2, replied_at = now(), status = 'answered', reply_seen_at = NULL
       WHERE id = $3 AND school_id = $4 AND ($5::bigint IS NULL OR assigned_to = $5) RETURNING *`,
      [reply, userId, enquiryId, schoolId, assignedTo]
    );
    return r.rows[0] || null;
  });
}

/** Teachers an enquiry can be forwarded to: the student's class teacher, their subject teachers, then everyone else. */
async function listForwardTargets(schoolId, enquiryId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `WITH enq AS (
         SELECT s.current_class_id AS class_id FROM guardian_enquiries e
         LEFT JOIN students s ON s.id = e.student_id
         WHERE e.id = $2 AND e.school_id = $1
       )
       SELECT id, full_name, relation FROM (
         SELECT u.id, u.full_name,
           CASE
             WHEN EXISTS (SELECT 1 FROM classes c, enq WHERE c.id = enq.class_id AND c.class_teacher_id = u.id) THEN 'class_teacher'
             WHEN EXISTS (SELECT 1 FROM teaching_assignments ta, enq WHERE ta.class_id = enq.class_id AND ta.teacher_id = u.id) THEN 'subject_teacher'
             ELSE 'other'
           END AS relation
         FROM users u JOIN roles ro ON ro.id = u.role_id
         WHERE u.school_id = $1 AND ro.code = 'teacher' AND u.is_active
       ) t
       ORDER BY CASE relation WHEN 'class_teacher' THEN 0 WHEN 'subject_teacher' THEN 1 ELSE 2 END, full_name`,
      [schoolId, enquiryId]
    );
    return r.rows;
  });
}

/** Hands an enquiry to a teacher. Returns null if the enquiry doesn't exist; throws 'INVALID_TEACHER' if the target isn't an active teacher here. */
async function forwardEnquiry(schoolId, { enquiryId, teacherId, forwardedBy, note }) {
  return withTenantClient(schoolId, async (client) => {
    const t = await client.query(
      `SELECT u.id FROM users u JOIN roles ro ON ro.id = u.role_id
       WHERE u.id = $1 AND u.school_id = $2 AND ro.code = 'teacher' AND u.is_active`,
      [teacherId, schoolId]
    );
    if (!t.rows[0]) throw new Error('INVALID_TEACHER');
    const r = await client.query(
      `UPDATE guardian_enquiries
       SET assigned_to = $1, forwarded_by = $2, forwarded_at = now(), forward_note = $3
       WHERE id = $4 AND school_id = $5 RETURNING id`,
      [teacherId, forwardedBy, note || null, enquiryId, schoolId]
    );
    return r.rows[0] || null;
  });
}

/** Take an enquiry back (unassign). */
async function unassignEnquiry(schoolId, enquiryId) {
  return withTenantClient(schoolId, async (client) => {
    const r = await client.query(
      `UPDATE guardian_enquiries SET assigned_to = NULL, forwarded_by = NULL, forwarded_at = NULL, forward_note = NULL
       WHERE id = $1 AND school_id = $2 RETURNING id`,
      [enquiryId, schoolId]
    );
    return r.rows[0] || null;
  });
}

/** Badge counts. teacherId set → scoped to that teacher; otherwise whole school. */
async function staffSummary(schoolId, { teacherId = null } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const enq = await client.query(
      `SELECT COUNT(*)::int AS n FROM guardian_enquiries
       WHERE school_id = $1 AND status = 'open' AND ($2::bigint IS NULL OR assigned_to = $2)`,
      [schoolId, teacherId]
    );
    const abs = await client.query(
      `SELECT COUNT(*)::int AS n FROM absence_reports ar
       WHERE ar.school_id = $1 AND ar.status = 'submitted' AND ar.date_to >= CURRENT_DATE
         AND ($2::bigint IS NULL OR EXISTS (
           SELECT 1 FROM students s JOIN classes c ON c.id = s.current_class_id
           WHERE s.id = ar.student_id AND c.class_teacher_id = $2 AND c.school_id = $1))`,
      [schoolId, teacherId]
    );
    return { openEnquiries: enq.rows[0].n, pendingAbsences: abs.rows[0].n };
  });
}

module.exports = {
  currentTerm, updateContact,
  listInbox, unreadCount, markRead, markAllRead,
  listTeachersForClass, listPaymentsByStudent,
  createAbsenceReport, listAbsenceReportsByStudent, cancelAbsenceReport, listAbsenceReportsForStaff, acknowledgeAbsenceReport,
  createEnquiry, listEnquiriesByGuardian, markEnquiryReplySeen, unseenReplyCount, listEnquiriesForStaff, getEnquiryForStaff, replyToEnquiry,
  listForwardTargets, forwardEnquiry, unassignEnquiry, staffSummary,
};