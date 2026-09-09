const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const attendanceModel = require('../models/attendance.model');

const markAttendance = asyncHandler(async (req, res) => {
  const { classId, date, records } = req.body;
  if (!classId || !date || !Array.isArray(records) || records.length === 0) {
    throw new ApiError(400, 'classId, date and a non-empty records array are required');
  }
  const validStatuses = ['present', 'absent', 'late', 'excused'];
  for (const r of records) {
    if (!r.studentId || !validStatuses.includes(r.status)) {
      throw new ApiError(400, `Each record needs studentId and a valid status (${validStatuses.join(', ')})`);
    }
  }
  const result = await attendanceModel.markClassAttendance(req.user.school_id, {
    classId, date, recordedBy: req.user.id, records,
  });
  return sendSuccess(res, 201, result, 'Attendance recorded');
});

const getClassAttendance = asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) throw new ApiError(400, 'date query param is required');
  const records = await attendanceModel.getByClassAndDate(req.user.school_id, req.params.classId, date);
  return sendSuccess(res, 200, records);
});

const getStudentAttendance = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate query params are required');
  const records = await attendanceModel.getByStudentRange(req.user.school_id, req.params.studentId, startDate, endDate);
  return sendSuccess(res, 200, records);
});

const getStudentAttendanceSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate query params are required');
  const summary = await attendanceModel.getStudentSummary(req.user.school_id, req.params.studentId, startDate, endDate);
  return sendSuccess(res, 200, summary);
});

module.exports = { markAttendance, getClassAttendance, getStudentAttendance, getStudentAttendanceSummary };
