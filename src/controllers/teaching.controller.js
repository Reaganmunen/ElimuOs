const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const teachingAssignmentModel = require('../models/teachingAssignment.model');
const timetableModel = require('../models/timetable.model');

const createAssignment = asyncHandler(async (req, res) => {
  const { classId, learningAreaId, teacherId, academicYearId } = req.body;
  if (!classId || !learningAreaId || !teacherId || !academicYearId) {
    throw new ApiError(400, 'classId, learningAreaId, teacherId and academicYearId are required');
  }
  const assignment = await teachingAssignmentModel.create(req.user.school_id, {
    classId, learningAreaId, teacherId, academicYearId,
  });
  return sendSuccess(res, 201, assignment, 'Teaching assignment created');
});

const listAssignmentsByClass = asyncHandler(async (req, res) => {
  const assignments = await teachingAssignmentModel.listByClass(req.user.school_id, req.params.classId);
  return sendSuccess(res, 200, assignments);
});

const listMyAssignments = asyncHandler(async (req, res) => {
  const assignments = await teachingAssignmentModel.listByTeacher(req.user.school_id, req.user.id);
  return sendSuccess(res, 200, assignments);
});

const removeAssignment = asyncHandler(async (req, res) => {
  const result = await teachingAssignmentModel.remove(req.user.school_id, req.params.id);
  if (!result) throw new ApiError(404, 'Teaching assignment not found');
  return sendSuccess(res, 200, result, 'Teaching assignment removed');
});

const createTimetableSlot = asyncHandler(async (req, res) => {
  const { teachingAssignmentId, dayOfWeek, startTime, endTime } = req.body;
  if (!teachingAssignmentId || !dayOfWeek || !startTime || !endTime) {
    throw new ApiError(400, 'teachingAssignmentId, dayOfWeek, startTime and endTime are required');
  }
  const slot = await timetableModel.create(req.user.school_id, { teachingAssignmentId, dayOfWeek, startTime, endTime });
  return sendSuccess(res, 201, slot, 'Timetable slot created');
});

const listTimetableByClass = asyncHandler(async (req, res) => {
  const slots = await timetableModel.listByClass(req.user.school_id, req.params.classId);
  return sendSuccess(res, 200, slots);
});

const listMyTimetable = asyncHandler(async (req, res) => {
  const slots = await timetableModel.listByTeacher(req.user.school_id, req.user.id);
  return sendSuccess(res, 200, slots);
});

const removeTimetableSlot = asyncHandler(async (req, res) => {
  const result = await timetableModel.remove(req.user.school_id, req.params.id);
  if (!result) throw new ApiError(404, 'Timetable slot not found');
  return sendSuccess(res, 200, result, 'Timetable slot removed');
});

module.exports = {
  createAssignment, listAssignmentsByClass, listMyAssignments, removeAssignment,
  createTimetableSlot, listTimetableByClass, listMyTimetable, removeTimetableSlot,
};
