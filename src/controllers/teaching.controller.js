const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const teachingAssignmentModel = require('../models/teachingAssignment.model');
const timetableModel = require('../models/timetable.model');
const timetableConfigModel = require('../models/timetableConfig.model');

const createAssignment = asyncHandler(async (req, res) => {
  const { classId, learningAreaId, teacherId, academicYearId, periodsPerWeek } = req.body;
  if (!classId || !learningAreaId || !teacherId || !academicYearId) {
    throw new ApiError(400, 'classId, learningAreaId, teacherId and academicYearId are required');
  }
  const assignment = await teachingAssignmentModel.create(req.user.school_id, {
    classId, learningAreaId, teacherId, academicYearId, periodsPerWeek,
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
  try {
    const slot = await timetableModel.create(req.user.school_id, { teachingAssignmentId, dayOfWeek, startTime, endTime });
    return sendSuccess(res, 201, slot, 'Timetable slot created');
  } catch (err) {
    // e.g. "Teaching assignment not found in this school" or the new
    // class/teacher overlap conflict message — both expected client
    // errors, not server faults.
    throw new ApiError(409, err.message);
  }
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

const getTimetableConfig = asyncHandler(async (req, res) => {
  const config = await timetableConfigModel.get(req.user.school_id);
  return sendSuccess(res, 200, config);
});

const updateTimetableConfig = asyncHandler(async (req, res) => {
  const { workingDays, periodsPerDay, periodDurationMinutes, dayStartTime, breaks } = req.body;
  const config = await timetableConfigModel.upsert(req.user.school_id, {
    workingDays, periodsPerDay, periodDurationMinutes, dayStartTime, breaks,
  });
  return sendSuccess(res, 200, config, 'Timetable configuration saved');
});

/**
 * Generates (and replaces) the timetable for every class in the school
 * for one academic year. See timetable.model.js generateForSchool for why
 * this always runs whole-school rather than one class at a time.
 */
const generateTimetable = asyncHandler(async (req, res) => {
  const { academicYearId, allowDoublePeriods } = req.body;
  if (!academicYearId) throw new ApiError(400, 'academicYearId is required');

  try {
    const result = await timetableModel.generateForSchool(req.user.school_id, academicYearId, {
      allowDoublePeriods: allowDoublePeriods !== false,
      actorUserId: req.user.id,
    });
    const message = result.unplaced.length > 0
      ? `Timetable generated with ${result.unplaced.length} period(s) that couldn't be placed — see "unplaced" for which subjects/classes need a manual slot or a lower periods-per-week.`
      : 'Timetable generated';
    return sendSuccess(res, 201, result, message);
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

module.exports = {
  createAssignment, listAssignmentsByClass, listMyAssignments, removeAssignment,
  createTimetableSlot, listTimetableByClass, listMyTimetable, removeTimetableSlot,
  getTimetableConfig, updateTimetableConfig, generateTimetable,
};
