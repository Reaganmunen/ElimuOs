const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const academicYearModel = require('../models/academicYear.model');
const termModel = require('../models/term.model');

const createAcademicYear = asyncHandler(async (req, res) => {
  const { yearLabel, startDate, endDate } = req.body;
  if (!yearLabel || !startDate || !endDate) {
    throw new ApiError(400, 'yearLabel, startDate and endDate are required');
  }
  const year = await academicYearModel.create(req.user.school_id, { yearLabel, startDate, endDate });
  return sendSuccess(res, 201, year, 'Academic year created');
});

const listAcademicYears = asyncHandler(async (req, res) => {
  const years = await academicYearModel.listBySchool(req.user.school_id);
  return sendSuccess(res, 200, years);
});

const setCurrentAcademicYear = asyncHandler(async (req, res) => {
  const year = await academicYearModel.setCurrent(req.user.school_id, req.params.id);
  if (!year) throw new ApiError(404, 'Academic year not found');
  return sendSuccess(res, 200, year, 'Current academic year updated');
});

const createTerm = asyncHandler(async (req, res) => {
  const { termNumber, startDate, endDate } = req.body;
  if (!termNumber || !startDate || !endDate) {
    throw new ApiError(400, 'termNumber, startDate and endDate are required');
  }
  const term = await termModel.create(req.user.school_id, {
    academicYearId: req.params.id,
    termNumber,
    startDate,
    endDate,
  });
  return sendSuccess(res, 201, term, 'Term created');
});

const listTerms = asyncHandler(async (req, res) => {
  const terms = await termModel.listByAcademicYear(req.user.school_id, req.params.id);
  return sendSuccess(res, 200, terms);
});

module.exports = { createAcademicYear, listAcademicYears, setCurrentAcademicYear, createTerm, listTerms };
