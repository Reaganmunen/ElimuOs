const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const model = require('../models/teacherPortal.model');

/**
 * Authorisation for everything a teacher does to a class:
 *   class teacher  → whole-class views (overall performance, guardians)
 *   subject teacher → only the subjects they're assigned in that class
 * school_id always comes from the JWT; the class is then checked to be in that school.
 */
async function access(req, classId) {
  const a = await model.getClassAccess(req.user.school_id, req.user.id, classId);
  if (!a) throw new ApiError(404, 'Class not found');
  return a;
}
const teaches = (a, learningAreaId) => a.learningAreaIds.includes(String(learningAreaId));

async function assertCanGradeSubStrand(a, subStrandId) {
  const sub = await model.resolveSubStrand(subStrandId);
  if (!sub) throw new ApiError(404, 'Sub-strand not found');
  if (String(sub.grade_id) !== String(a.cls.grade_id)) throw new ApiError(400, "That sub-strand isn't part of this class's grade");
  if (!teaches(a, sub.learning_area_id)) throw new ApiError(403, "You aren't assigned to teach this subject in this class");
}

const getOverview = asyncHandler(async (req, res) =>
  sendSuccess(res, 200, await model.getOverview(req.user.school_id, req.user.id)));

const getGradeSheet = asyncHandler(async (req, res) => {
  const { subStrandId, termId } = req.query;
  if (!subStrandId || !termId) throw new ApiError(400, 'subStrandId and termId are required');
  const a = await access(req, req.params.classId);
  await assertCanGradeSubStrand(a, subStrandId);
  const students = await model.getGradeSheet(req.user.school_id, { classId: req.params.classId, subStrandId, termId });
  return sendSuccess(res, 200, { students });
});

const saveGrades = asyncHandler(async (req, res) => {
  const { subStrandId, termId, assessmentDate, results } = req.body;
  if (!subStrandId || !termId) throw new ApiError(400, 'subStrandId and termId are required');
  if (!Array.isArray(results) || results.length === 0) throw new ApiError(400, 'A non-empty results array is required');
  if (results.some((r) => !r.studentId || !r.rubricLevelId)) throw new ApiError(400, 'Each result needs studentId and rubricLevelId');
  const a = await access(req, req.params.classId);
  await assertCanGradeSubStrand(a, subStrandId);
  try {
    const saved = await model.saveGrades(req.user.school_id, req.user.id, {
      classId: req.params.classId, subStrandId, termId, assessmentDate, results,
    });
    return sendSuccess(res, 201, saved, 'Grades saved');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

const getPerformance = asyncHandler(async (req, res) => {
  const { termId, learningAreaId } = req.query;
  if (!termId) throw new ApiError(400, 'termId is required');
  const a = await access(req, req.params.classId);
  if (learningAreaId) {
    if (!a.isClassTeacher && !teaches(a, learningAreaId)) throw new ApiError(403, "You aren't assigned to teach this subject in this class");
  } else if (!a.isClassTeacher) {
    throw new ApiError(403, 'Overall performance is only available to the class teacher');
  }
  try {
    const students = await model.getPerformance(req.user.school_id, { classId: req.params.classId, termId, learningAreaId });
    return sendSuccess(res, 200, { scope: learningAreaId ? 'subject' : 'class', students });
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

const getClassGuardians = asyncHandler(async (req, res) => {
  const a = await access(req, req.params.classId);
  if (!a.isClassTeacher) throw new ApiError(403, "Guardian details are only available to the class's own class teacher");
  const students = await model.getClassGuardians(req.user.school_id, req.params.classId);
  return sendSuccess(res, 200, { students });
});

module.exports = { getOverview, getGradeSheet, saveGrades, getPerformance, getClassGuardians };
