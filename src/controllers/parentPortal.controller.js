const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const guardianModel = require('../models/guardian.model');
const studentModel = require('../models/student.model');
const assessmentModel = require('../models/assessment.model');
const reportCardModel = require('../models/reportCard.model');
const attendanceModel = require('../models/attendance.model');
const invoiceModel = require('../models/invoice.model');
const timetableModel = require('../models/timetable.model');
const mpesaModel = require('../models/mpesa.model');
const userModel = require('../models/user.model');
const refreshTokenModel = require('../models/refreshToken.model');
const portalModel = require('../models/guardianPortal.model');
const { renderReportCardPdf } = require('../utils/reportCardPdf.util');
const { normalizeKenyanPhone } = require('../utils/phone.util');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');
const { comparePassword, hashPassword } = require('../utils/password.util');

const listMyChildren = asyncHandler(async (req, res) => {
  const guardian = await guardianModel.findByUserId(req.user.school_id, req.user.id);
  if (!guardian) throw new ApiError(404, 'No guardian record is linked to this account');
  const children = await guardianModel.listStudentsByGuardian(req.user.school_id, guardian.id);
  return sendSuccess(res, 200, children);
});

const getChild = asyncHandler(async (req, res) => {
  // req.params.studentId ownership already verified by the router.param
  // middleware below before this handler ever runs.
  const student = await studentModel.findById(req.user.school_id, req.params.studentId);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student);
});

const getChildReportCard = asyncHandler(async (req, res) => {
  const { studentId, termId } = req.params;
  const reportCard = await reportCardModel.getByStudentAndTerm(req.user.school_id, studentId, termId);
  const results = await assessmentModel.getStudentTermResults(req.user.school_id, studentId, termId);
  return sendSuccess(res, 200, { reportCard, results });
});

const downloadChildReportCardPdf = asyncHandler(async (req, res) => {
  const { studentId, termId } = req.params;
  const bundle = await reportCardModel.getBundle(req.user.school_id, studentId, termId);
  if (!bundle) throw new ApiError(404, 'Student or term not found');

  const pdfBuffer = await renderReportCardPdf(bundle);
  const safeName = bundle.student.full_name.replace(/[^a-z0-9]/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-card-${safeName}-term${bundle.term.term_number}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
});

const getChildAttendance = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate query params are required');
  const summary = await attendanceModel.getStudentSummary(req.user.school_id, req.params.studentId, startDate, endDate);
  return sendSuccess(res, 200, summary);
});

const listChildInvoices = asyncHandler(async (req, res) => {
  const invoices = await invoiceModel.listByStudent(req.user.school_id, req.params.studentId);
  return sendSuccess(res, 200, invoices);
});

const getChildInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceModel.getById(req.user.school_id, req.params.invoiceId);
  if (!invoice || String(invoice.student_id) !== String(req.params.studentId)) {
    // The invoice must belong to the student we already verified —
    // otherwise a parent could probe a sibling-scoped route with an
    // unrelated invoiceId that happens to exist in the same school.
    throw new ApiError(404, 'Invoice not found for this student');
  }
  return sendSuccess(res, 200, invoice);
});


// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function resolveGuardian(req) {
  const guardian = await guardianModel.findByUserId(req.user.school_id, req.user.id);
  if (!guardian) throw new ApiError(404, 'No guardian record is linked to this account');
  return guardian;
}
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const ymd = (d) => new Date(d).toLocaleDateString('en-CA');

// ---------------------------------------------------------------------
// Guardian profile
// ---------------------------------------------------------------------
const getMe = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const user = await userModel.findById(req.user.id, req.user.school_id);
  return sendSuccess(res, 200, {
    id: guardian.id, full_name: guardian.full_name, phone: guardian.phone, email: guardian.email,
    national_id: guardian.national_id, login_email: user ? user.email : null,
  });
});

// Contact details only — name and national ID are school records that only the office may change.
const updateMe = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const { phone, email } = req.body;
  let normalized = null;
  if (phone) {
    normalized = normalizeKenyanPhone(phone);
    if (!normalized) throw new ApiError(400, 'phone must be a valid Kenyan mobile number, e.g. 0712345678');
  }
  const cleanEmail = email ? String(email).trim() : null;
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new ApiError(400, 'email is not valid');
  const updated = await portalModel.updateContact(req.user.school_id, guardian.id, { phone: normalized, email: cleanEmail });
  return sendSuccess(res, 200, updated, 'Contact details updated');
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ApiError(400, 'currentPassword and newPassword are required');
  const user = await userModel.findById(req.user.id, req.user.school_id);
  if (!user) throw new ApiError(404, 'Account not found');
  const full = await userModel.findByEmailInSchool(user.email, req.user.school_id);
  if (!full || !(await comparePassword(currentPassword, full.password_hash))) throw new ApiError(400, 'Current password is incorrect');
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new ApiError(400, weak);
  if (currentPassword === newPassword) throw new ApiError(400, 'New password must be different from the current one');
  await userModel.updatePasswordHash(req.user.id, await hashPassword(newPassword));
  // Sign every device out — the client sends the user back to the login page.
  await refreshTokenModel.revokeAllForUser(req.user.id);
  return sendSuccess(res, 200, null, 'Password changed. Please log in again.');
});

// ---------------------------------------------------------------------
// Dashboard summary — one call for the overview page
// ---------------------------------------------------------------------
const getSummary = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const guardian = await resolveGuardian(req);
  const [children, term, unread, unseenReplies] = await Promise.all([
    guardianModel.listStudentsByGuardian(schoolId, guardian.id),
    portalModel.currentTerm(schoolId),
    portalModel.unreadCount(schoolId, guardian.id),
    portalModel.unseenReplyCount(schoolId, guardian.id),
  ]);

  const today = ymd(new Date());
  const rows = await Promise.all(children.map(async (c) => {
    const invoices = await invoiceModel.listByStudent(schoolId, c.id);
    const open = invoices.filter((i) => Number(i.total_amount) - Number(i.amount_paid || 0) > 0.005);
    const balance = open.reduce((t, i) => t + (Number(i.total_amount) - Number(i.amount_paid || 0)), 0);
    const overdue = open.filter((i) => i.due_date && ymd(i.due_date) < today)
      .reduce((t, i) => t + (Number(i.total_amount) - Number(i.amount_paid || 0)), 0);
    const nextDue = open.filter((i) => i.due_date).map((i) => ymd(i.due_date)).sort()[0] || null;

    let attendance = null;
    if (term) {
      const end = ymd(term.end_date) < today ? ymd(term.end_date) : today;
      if (ymd(term.start_date) <= end) {
        attendance = await attendanceModel.getStudentSummary(schoolId, c.id, ymd(term.start_date), end);
      }
    }
    return {
      id: c.id, full_name: c.full_name, admission_number: c.admission_number, relationship: c.relationship,
      current_class_id: c.current_class_id, balance, overdue, next_due_date: nextDue, attendance,
    };
  }));

  return sendSuccess(res, 200, {
    guardian: { id: guardian.id, full_name: guardian.full_name },
    term, children: rows,
    totals: { balance: rows.reduce((t, c) => t + c.balance, 0), overdue: rows.reduce((t, c) => t + c.overdue, 0) },
    unreadMessages: unread, unseenEnquiryReplies: unseenReplies,
  });
});

// ---------------------------------------------------------------------
// Child-scoped extras (ownership already verified by router.param)
// ---------------------------------------------------------------------
const getChildTimetable = asyncHandler(async (req, res) => {
  const student = await studentModel.findById(req.user.school_id, req.params.studentId);
  if (!student) throw new ApiError(404, 'Student not found');
  if (!student.current_class_id) return sendSuccess(res, 200, []);
  return sendSuccess(res, 200, await timetableModel.listByClass(req.user.school_id, student.current_class_id));
});

const getChildAttendanceRecords = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!isDate(startDate) || !isDate(endDate)) throw new ApiError(400, 'startDate and endDate (YYYY-MM-DD) are required');
  const rows = await attendanceModel.getByStudentRange(req.user.school_id, req.params.studentId, startDate, endDate);
  return sendSuccess(res, 200, rows.map((r) => ({ date: r.date, status: r.status, remark: r.remark })));
});

const getChildTeachers = asyncHandler(async (req, res) => {
  const student = await studentModel.findById(req.user.school_id, req.params.studentId);
  if (!student) throw new ApiError(404, 'Student not found');
  if (!student.current_class_id) return sendSuccess(res, 200, { classTeacher: null, subjectTeachers: [] });
  return sendSuccess(res, 200, await portalModel.listTeachersForClass(req.user.school_id, student.current_class_id));
});

const listChildPayments = asyncHandler(async (req, res) => {
  return sendSuccess(res, 200, await portalModel.listPaymentsByStudent(req.user.school_id, req.params.studentId));
});

// STK attempts for one invoice — the portal polls this after starting a payment.
const listChildInvoiceTransactions = asyncHandler(async (req, res) => {
  const invoice = await invoiceModel.getById(req.user.school_id, req.params.invoiceId);
  if (!invoice || String(invoice.student_id) !== String(req.params.studentId)) throw new ApiError(404, 'Invoice not found for this student');
  const txns = await mpesaModel.listByInvoice(req.user.school_id, req.params.invoiceId);
  // Don't hand the raw Daraja callback payload to the browser.
  return sendSuccess(res, 200, txns.map(({ raw_callback_payload, ...t }) => t)); // eslint-disable-line no-unused-vars
});

// Everything needed to render/print a fee statement in one call.
const getChildFeeStatement = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const student = await studentModel.findById(schoolId, req.params.studentId);
  if (!student) throw new ApiError(404, 'Student not found');
  const list = await invoiceModel.listByStudent(schoolId, student.id);
  const invoices = await Promise.all(list.map((i) => invoiceModel.getById(schoolId, i.id)));
  const payments = await portalModel.listPaymentsByStudent(schoolId, student.id);
  return sendSuccess(res, 200, { student, invoices: invoices.filter(Boolean), payments, generatedAt: new Date().toISOString() });
});

// ---------------------------------------------------------------------
// Absence / late / early-pickup notices
// ---------------------------------------------------------------------
const REPORT_TYPES = ['absent', 'late_arrival', 'early_pickup'];

const listChildAbsenceReports = asyncHandler(async (req, res) => {
  return sendSuccess(res, 200, await portalModel.listAbsenceReportsByStudent(req.user.school_id, req.params.studentId));
});

const createChildAbsenceReport = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const { reportType, dateFrom, dateTo, expectedTime, reason } = req.body;
  if (!REPORT_TYPES.includes(reportType)) throw new ApiError(400, `reportType must be one of: ${REPORT_TYPES.join(', ')}`);
  if (!isDate(dateFrom)) throw new ApiError(400, 'dateFrom must be a YYYY-MM-DD date');
  const to = dateTo || dateFrom;
  if (!isDate(to)) throw new ApiError(400, 'dateTo must be a YYYY-MM-DD date');
  if (to < dateFrom) throw new ApiError(400, 'dateTo cannot be before dateFrom');

  const today = ymd(new Date());
  const weekAgo = ymd(new Date(Date.now() - 7 * 86400000));
  const maxAhead = ymd(new Date(Date.now() + 120 * 86400000));
  if (dateFrom < weekAgo) throw new ApiError(400, 'You can only report absences from the last 7 days onward');
  if (to > maxAhead) throw new ApiError(400, 'That date is too far ahead');
  if (reportType !== 'absent' && to !== dateFrom) throw new ApiError(400, 'Late arrival and early pickup are for a single day');
  if (reportType === 'absent' && (Date.parse(to) - Date.parse(dateFrom)) / 86400000 > 60) throw new ApiError(400, 'An absence notice can cover at most 60 days');
  if (expectedTime && !isTime(expectedTime)) throw new ApiError(400, 'expectedTime must be HH:MM');
  if (reportType !== 'absent' && !expectedTime) throw new ApiError(400, 'expectedTime is required for late arrival / early pickup');
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 3) throw new ApiError(400, 'Please give a short reason');
  if (cleanReason.length > 500) throw new ApiError(400, 'Reason must be 500 characters or fewer');

  const report = await portalModel.createAbsenceReport(req.user.school_id, {
    studentId: req.params.studentId, guardianId: guardian.id, reportType, dateFrom, dateTo: to,
    expectedTime: reportType === 'absent' ? null : expectedTime, reason: cleanReason,
  });
  return sendSuccess(res, 201, report, 'The school has been notified');
});

const cancelChildAbsenceReport = asyncHandler(async (req, res) => {
  const cancelled = await portalModel.cancelAbsenceReport(req.user.school_id, {
    reportId: req.params.reportId, studentId: req.params.studentId,
  });
  if (!cancelled) throw new ApiError(404, 'Notice not found, or the school has already acknowledged it');
  return sendSuccess(res, 200, cancelled, 'Notice withdrawn');
});

// ---------------------------------------------------------------------
// Inbox — school broadcasts sent to this guardian
// ---------------------------------------------------------------------
const listMessages = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const { unread, limit, offset } = req.query;
  const rows = await portalModel.listInbox(req.user.school_id, guardian.id, {
    unreadOnly: unread === 'true', limit: Math.min(Number(limit) || 50, 100), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, rows);
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  return sendSuccess(res, 200, { unread: await portalModel.unreadCount(req.user.school_id, guardian.id) });
});

const markMessageRead = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const ok = await portalModel.markRead(req.user.school_id, guardian.id, req.params.messageId);
  if (!ok) throw new ApiError(404, 'Message not found');
  return sendSuccess(res, 200, null, 'Marked as read');
});

const markAllMessagesRead = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const n = await portalModel.markAllRead(req.user.school_id, guardian.id);
  return sendSuccess(res, 200, { updated: n }, 'All messages marked as read');
});

// ---------------------------------------------------------------------
// Enquiries to the school office
// ---------------------------------------------------------------------
const listEnquiries = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  return sendSuccess(res, 200, await portalModel.listEnquiriesByGuardian(req.user.school_id, guardian.id));
});

const createEnquiry = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const { studentId, subject, body } = req.body;
  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (cleanSubject.length < 3 || cleanSubject.length > 150) throw new ApiError(400, 'Subject must be 3–150 characters');
  if (cleanBody.length < 5 || cleanBody.length > 2000) throw new ApiError(400, 'Message must be 5–2000 characters');
  if (studentId) {
    // Same ownership rule as every child-scoped route: only tag a child that is yours.
    const owns = await guardianModel.isGuardianOfStudent(req.user.school_id, req.user.id, studentId);
    if (!owns) throw new ApiError(404, 'Student not found');
  }
  const enquiry = await portalModel.createEnquiry(req.user.school_id, {
    guardianId: guardian.id, studentId: studentId || null, subject: cleanSubject, body: cleanBody,
  });
  return sendSuccess(res, 201, enquiry, 'Your message has been sent to the school');
});

const markEnquirySeen = asyncHandler(async (req, res) => {
  const guardian = await resolveGuardian(req);
  const ok = await portalModel.markEnquiryReplySeen(req.user.school_id, guardian.id, req.params.enquiryId);
  if (!ok) throw new ApiError(404, 'Enquiry not found');
  return sendSuccess(res, 200, null, 'OK');
});

module.exports = {
  listMyChildren, getChild, getChildReportCard, downloadChildReportCardPdf,
  getChildAttendance, listChildInvoices, getChildInvoice,
  getMe, updateMe, changePassword, getSummary,
  getChildTimetable, getChildAttendanceRecords, getChildTeachers, listChildPayments,
  listChildInvoiceTransactions, getChildFeeStatement,
  listChildAbsenceReports, createChildAbsenceReport, cancelChildAbsenceReport,
  listMessages, getUnreadCount, markMessageRead, markAllMessagesRead,
  listEnquiries, createEnquiry, markEnquirySeen,
};