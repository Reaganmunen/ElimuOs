const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const assessmentModel = require('../models/assessment.model');
const reportCardModel = require('../models/reportCard.model');

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
 * Generates (or regenerates) a term report card snapshot for one student.
 * NOTE: this saves the underlying data (remarks + which results exist at
 * generation time); it does not render a PDF. Wire this up to the pdf
 * skill / a templating step when you're ready to produce the actual
 * downloadable document — generated_pdf_url is left for that follow-up.
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

module.exports = {
  createAssessment, recordResults, getAssessmentResults, getStudentTermResults,
  generateReportCard, getReportCard,
};
