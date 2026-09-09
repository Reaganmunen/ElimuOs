const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const classModel = require('../models/class.model');
const studentModel = require('../models/student.model');

const createClass = asyncHandler(async (req, res) => {
  const { gradeId, academicYearId, streamName, classTeacherId } = req.body;
  if (!gradeId || !academicYearId) {
    throw new ApiError(400, 'gradeId and academicYearId are required');
  }
  const cls = await classModel.create(req.user.school_id, { gradeId, academicYearId, streamName, classTeacherId });
  return sendSuccess(res, 201, cls, 'Class created');
});

const listClasses = asyncHandler(async (req, res) => {
  const { academicYearId } = req.query;
  const classes = await classModel.listBySchool(req.user.school_id, { academicYearId });
  return sendSuccess(res, 200, classes);
});

const getClass = asyncHandler(async (req, res) => {
  const cls = await classModel.findById(req.user.school_id, req.params.id);
  if (!cls) throw new ApiError(404, 'Class not found');
  return sendSuccess(res, 200, cls);
});

const updateClass = asyncHandler(async (req, res) => {
  const { streamName, classTeacherId } = req.body;
  const cls = await classModel.update(req.user.school_id, req.params.id, { streamName, classTeacherId });
  if (!cls) throw new ApiError(404, 'Class not found');
  return sendSuccess(res, 200, cls, 'Class updated');
});

const listClassStudents = asyncHandler(async (req, res) => {
  const students = await studentModel.listByClass(req.user.school_id, req.params.id);
  return sendSuccess(res, 200, students);
});

module.exports = { createClass, listClasses, getClass, updateClass, listClassStudents };
