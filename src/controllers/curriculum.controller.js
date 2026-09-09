const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const curriculumModel = require('../models/curriculum.model');

const getEducationLevels = asyncHandler(async (req, res) => {
  const levels = await curriculumModel.listEducationLevels();
  return sendSuccess(res, 200, levels);
});

const getGrades = asyncHandler(async (req, res) => {
  const grades = await curriculumModel.listGrades(req.query.educationLevelId);
  return sendSuccess(res, 200, grades);
});

const getLearningAreas = asyncHandler(async (req, res) => {
  const areas = await curriculumModel.listLearningAreas(req.params.gradeId);
  return sendSuccess(res, 200, areas);
});

const getStrands = asyncHandler(async (req, res) => {
  const strands = await curriculumModel.listStrands(req.params.learningAreaId);
  return sendSuccess(res, 200, strands);
});

const getSubStrands = asyncHandler(async (req, res) => {
  const subStrands = await curriculumModel.listSubStrands(req.params.strandId);
  return sendSuccess(res, 200, subStrands);
});

const getLearningOutcomes = asyncHandler(async (req, res) => {
  const outcomes = await curriculumModel.listLearningOutcomes(req.params.subStrandId, req.query.term);
  return sendSuccess(res, 200, outcomes);
});

const getRubricLevels = asyncHandler(async (req, res) => {
  const levels = await curriculumModel.listRubricLevels();
  return sendSuccess(res, 200, levels);
});

const getGradeTree = asyncHandler(async (req, res) => {
  const tree = await curriculumModel.getFullTreeForGrade(req.params.gradeId);
  return sendSuccess(res, 200, tree);
});

module.exports = {
  getEducationLevels, getGrades, getLearningAreas, getStrands,
  getSubStrands, getLearningOutcomes, getRubricLevels, getGradeTree,
};
