const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const guardianModel = require('../models/guardian.model');
const studentModel = require('../models/student.model');
const assessmentModel = require('../models/assessment.model');
const reportCardModel = require('../models/reportCard.model');
const attendanceModel = require('../models/attendance.model');
const invoiceModel = require('../models/invoice.model');
const { renderReportCardPdf } = require('../utils/reportCardPdf.util');

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

module.exports = {
  listMyChildren, getChild, getChildReportCard, downloadChildReportCardPdf,
  getChildAttendance, listChildInvoices, getChildInvoice,
};