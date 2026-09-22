const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const studentModel = require('../models/student.model');
const assessmentModel = require('../models/assessment.model');
const reportCardModel = require('../models/reportCard.model');
const attendanceModel = require('../models/attendance.model');
const invoiceModel = require('../models/invoice.model');
const { renderReportCardPdf } = require('../utils/reportCardPdf.util');

/**
 * Every route below needs "which student row is this logged-in student
 * account", so it's resolved once here rather than repeating
 * studentModel.findByUserId in every handler. Unlike the parent portal,
 * there's no separate ownership check needed beyond this lookup — a
 * student portal account only ever represents itself (see the comment on
 * student.model.js findByUserId), so there's no equivalent to
 * guardianModel.isGuardianOfStudent required here.
 */
async function resolveSelf(req) {
  const student = await studentModel.findByUserId(req.user.school_id, req.user.id);
  if (!student) throw new ApiError(404, 'No student record is linked to this account');
  return student;
}

const getMe = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  return sendSuccess(res, 200, student);
});

const getMyReportCard = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  const { termId } = req.params;
  const reportCard = await reportCardModel.getByStudentAndTerm(req.user.school_id, student.id, termId);
  const results = await assessmentModel.getStudentTermResults(req.user.school_id, student.id, termId);
  return sendSuccess(res, 200, { reportCard, results });
});

const downloadMyReportCardPdf = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  const { termId } = req.params;
  const bundle = await reportCardModel.getBundle(req.user.school_id, student.id, termId);
  if (!bundle) throw new ApiError(404, 'Report card not found for that term');

  const pdfBuffer = await renderReportCardPdf(bundle);
  const safeName = bundle.student.full_name.replace(/[^a-z0-9]/gi, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-card-${safeName}-term${bundle.term.term_number}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
});

const getMyAttendance = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate query params are required');
  const summary = await attendanceModel.getStudentSummary(req.user.school_id, student.id, startDate, endDate);
  return sendSuccess(res, 200, summary);
});

const listMyInvoices = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  const invoices = await invoiceModel.listByStudent(req.user.school_id, student.id);
  return sendSuccess(res, 200, invoices);
});

const getMyInvoice = asyncHandler(async (req, res) => {
  const student = await resolveSelf(req);
  const invoice = await invoiceModel.getById(req.user.school_id, req.params.invoiceId);
  if (!invoice || String(invoice.student_id) !== String(student.id)) {
    // Same reasoning as the parent portal's equivalent check: the
    // invoice must belong to THIS student, not just this school —
    // otherwise a student could probe another student's invoice id.
    throw new ApiError(404, 'Invoice not found');
  }
  return sendSuccess(res, 200, invoice);
});

module.exports = {
  getMe, getMyReportCard, downloadMyReportCardPdf, getMyAttendance, listMyInvoices, getMyInvoice,
};
