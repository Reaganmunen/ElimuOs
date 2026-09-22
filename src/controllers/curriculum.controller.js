const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
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

// ---------------------------------------------------------------------
// Write handlers — super_admin only (see curriculum.model.js for why).
// update/delete share the same "call the model fn, 404 if it returns
// null" shape across all five levels of the tree, so that shape is
// factored into two small helpers rather than repeated six times; create
// handlers stay individual since each needs its own required-field
// validation message.
// ---------------------------------------------------------------------

const makeUpdateHandler = (modelFn, notFoundMessage) => asyncHandler(async (req, res) => {
  try {
    const updated = await modelFn(req.params.id, req.body, req.user.id);
    if (!updated) throw new ApiError(404, notFoundMessage);
    return sendSuccess(res, 200, updated, 'Updated');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, err.message);
  }
});

const makeDeleteHandler = (modelFn, notFoundMessage) => asyncHandler(async (req, res) => {
  const deleted = await modelFn(req.params.id, req.user.id);
  if (!deleted) throw new ApiError(404, notFoundMessage);
  return sendSuccess(res, 200, deleted, 'Deleted');
});

const createEducationLevel = asyncHandler(async (req, res) => {
  const { name, sortOrder } = req.body;
  if (!name || sortOrder == null) throw new ApiError(400, 'name and sortOrder are required');
  const level = await curriculumModel.createEducationLevel({ name, sortOrder }, req.user.id);
  return sendSuccess(res, 201, level, 'Education level created');
});
const updateEducationLevel = makeUpdateHandler(curriculumModel.updateEducationLevel, 'Education level not found');
const deleteEducationLevel = makeDeleteHandler(curriculumModel.deleteEducationLevel, 'Education level not found');

const createGrade = asyncHandler(async (req, res) => {
  const { educationLevelId, name, sortOrder } = req.body;
  if (!educationLevelId || !name || sortOrder == null) {
    throw new ApiError(400, 'educationLevelId, name and sortOrder are required');
  }
  try {
    const grade = await curriculumModel.createGrade({ educationLevelId, name, sortOrder }, req.user.id);
    return sendSuccess(res, 201, grade, 'Grade created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});
const updateGrade = makeUpdateHandler(curriculumModel.updateGrade, 'Grade not found');
const deleteGrade = makeDeleteHandler(curriculumModel.deleteGrade, 'Grade not found');

const createLearningArea = asyncHandler(async (req, res) => {
  const { gradeId, name } = req.body;
  if (!gradeId || !name) throw new ApiError(400, 'gradeId and name are required');
  try {
    const area = await curriculumModel.createLearningArea({ gradeId, name }, req.user.id);
    return sendSuccess(res, 201, area, 'Learning area created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});
const updateLearningArea = makeUpdateHandler(curriculumModel.updateLearningArea, 'Learning area not found');
const deleteLearningArea = makeDeleteHandler(curriculumModel.deleteLearningArea, 'Learning area not found');

const createStrand = asyncHandler(async (req, res) => {
  const { learningAreaId, name } = req.body;
  if (!learningAreaId || !name) throw new ApiError(400, 'learningAreaId and name are required');
  try {
    const strand = await curriculumModel.createStrand({ learningAreaId, name }, req.user.id);
    return sendSuccess(res, 201, strand, 'Strand created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});
const updateStrand = makeUpdateHandler(curriculumModel.updateStrand, 'Strand not found');
const deleteStrand = makeDeleteHandler(curriculumModel.deleteStrand, 'Strand not found');

const createSubStrand = asyncHandler(async (req, res) => {
  const { strandId, name } = req.body;
  if (!strandId || !name) throw new ApiError(400, 'strandId and name are required');
  try {
    const subStrand = await curriculumModel.createSubStrand({ strandId, name }, req.user.id);
    return sendSuccess(res, 201, subStrand, 'Sub-strand created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});
const updateSubStrand = makeUpdateHandler(curriculumModel.updateSubStrand, 'Sub-strand not found');
const deleteSubStrand = makeDeleteHandler(curriculumModel.deleteSubStrand, 'Sub-strand not found');

const createLearningOutcome = asyncHandler(async (req, res) => {
  const { subStrandId, termNumber, description } = req.body;
  if (!subStrandId || !termNumber || !description) {
    throw new ApiError(400, 'subStrandId, termNumber and description are required');
  }
  try {
    const outcome = await curriculumModel.createLearningOutcome({ subStrandId, termNumber, description }, req.user.id);
    return sendSuccess(res, 201, outcome, 'Learning outcome created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});
const updateLearningOutcome = makeUpdateHandler(curriculumModel.updateLearningOutcome, 'Learning outcome not found');
const deleteLearningOutcome = makeDeleteHandler(curriculumModel.deleteLearningOutcome, 'Learning outcome not found');

const updateRubricLevelLabel = asyncHandler(async (req, res) => {
  const { label } = req.body;
  if (!label) throw new ApiError(400, 'label is required');
  const updated = await curriculumModel.updateRubricLevelLabel(req.params.id, label, req.user.id);
  if (!updated) throw new ApiError(404, 'Rubric level not found');
  return sendSuccess(res, 200, updated, 'Rubric level label updated');
});

module.exports = {
  getEducationLevels, getGrades, getLearningAreas, getStrands,
  getSubStrands, getLearningOutcomes, getRubricLevels, getGradeTree,
  createEducationLevel, updateEducationLevel, deleteEducationLevel,
  createGrade, updateGrade, deleteGrade,
  createLearningArea, updateLearningArea, deleteLearningArea,
  createStrand, updateStrand, deleteStrand,
  createSubStrand, updateSubStrand, deleteSubStrand,
  createLearningOutcome, updateLearningOutcome, deleteLearningOutcome,
  updateRubricLevelLabel,
};
