const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const assessmentModel = require('../models/assessment.model');
const reportCardModel = require('../models/reportCard.model');
const { renderReportCardPdf } = require('../utils/reportCardPdf.util');

const createAssessment = asyncHandler(async (req, res) => {
  const { classId, subStrandId, termId, assessmentDate } = req.body;
  if (!classId || !subStrandId || !termId) {
    throw new ApiError(400, 'classId, subStrandId and termId are required');
  }
  const assessment = await assessmentModel.createAssessment(req.user.school_id, {
    classId, subStrandId, termId, teacherId: req.user.id, assessmentDate,
  });
  return sendSuccess(res, 201, assessment, 'Assessment created');
});

const recordResults = asyncHandler(async (req, res) => {
  const { results } = req.body;
  if (!Array.isArray(results) || results.length === 0) {
    throw new ApiError(400, 'A non-empty results array is required');
  }
  for (const r of results) {
    if (!r.studentId || !r.rubricLevelId) {
      throw new ApiError(400, 'Each result needs studentId and rubricLevelId');
    }
  }
  const saved = await assessmentModel.recordResults(req.user.school_id, req.params.id, results);
  return sendSuccess(res, 201, saved, 'Results recorded');
});

const getAssessmentResults = asyncHandler(async (req, res) => {
  const results = await assessmentModel.getResultsByAssessment(req.user.school_id, req.params.id);
  return sendSuccess(res, 200, results);
});

const getStudentTermResults = asyncHandler(async (req, res) => {
  const results = await assessmentModel.getStudentTermResults(req.user.school_id, req.params.studentId, req.params.termId);
  return sendSuccess(res, 200, results);
});

/**
 * Generates (or regenerates) a term report card snapshot for one student —
 * saves the remarks and confirms results exist. This is the DATA step;
 * the actual PDF is rendered on demand by downloadReportCardPdf below,
 * from the live data at download time, rather than generated once here
 * and cached — see that function's comment for why.
 */
const generateReportCard = asyncHandler(async (req, res) => {
  const { studentId, termId } = req.params;
  const { classTeacherRemark, headTeacherRemark } = req.body;

  const results = await assessmentModel.getStudentTermResults(req.user.school_id, studentId, termId);
  if (results.length === 0) {
    throw new ApiError(400, 'No assessment results exist for this student in this term yet');
  }

  const reportCard = await reportCardModel.upsert(req.user.school_id, {
    studentId, termId, classTeacherRemark, headTeacherRemark, generatedPdfUrl: null,
  });

  return sendSuccess(res, 201, { reportCard, results }, 'Report card data generated');
});

const getReportCard = asyncHandler(async (req, res) => {
  const { studentId, termId } = req.params;
  const reportCard = await reportCardModel.getByStudentAndTerm(req.user.school_id, studentId, termId);
  if (!reportCard) throw new ApiError(404, 'Report card not found for this student/term');
  const results = await assessmentModel.getStudentTermResults(req.user.school_id, studentId, termId);
  return sendSuccess(res, 200, { reportCard, results });
});

/**
 * Streams a rendered PDF of the report card. Deliberately renders fresh
 * on every request rather than generating once and serving a cached file
 * from disk/S3 — file storage isn't built yet (that's the next piece of
 * work), and rendering on demand means the PDF is always exactly current:
 * if a teacher fixes a rubric result or a remark gets edited after the
 * "generate" step ran, the very next download reflects that automatically
 * instead of silently serving a stale cached copy. The cost is a bit of
 * CPU per download, which is trivial for a document this size.
 *
 * Requires that generateReportCard has been called at least once for this
 * student/term (i.e. a report_cards row with remarks exists) — this
 * endpoint reads the same underlying data via reportCardModel.getBundle,
 * it just formats it as a PDF instead of JSON.
 */
const downloadReportCardPdf = asyncHandler(async (req, res) => {
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

module.exports = {
  createAssessment, recordResults, getAssessmentResults, getStudentTermResults,
  generateReportCard, getReportCard, downloadReportCardPdf,
};