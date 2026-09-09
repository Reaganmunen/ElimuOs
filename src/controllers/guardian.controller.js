const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const guardianModel = require('../models/guardian.model');

const createGuardian = asyncHandler(async (req, res) => {
  const { fullName, phone, email, nationalId } = req.body;
  if (!fullName || !phone) throw new ApiError(400, 'fullName and phone are required');
  const guardian = await guardianModel.create(req.user.school_id, { fullName, phone, email, nationalId });
  return sendSuccess(res, 201, guardian, 'Guardian created');
});

const searchGuardians = asyncHandler(async (req, res) => {
  const { q, limit, offset } = req.query;
  const guardians = await guardianModel.search(req.user.school_id, {
    q, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, guardians);
});

const getGuardian = asyncHandler(async (req, res) => {
  const guardian = await guardianModel.findById(req.user.school_id, req.params.id);
  if (!guardian) throw new ApiError(404, 'Guardian not found');
  return sendSuccess(res, 200, guardian);
});

const linkGuardianToStudent = asyncHandler(async (req, res) => {
  const { studentId, relationship, isPrimaryContact } = req.body;
  if (!studentId || !relationship) throw new ApiError(400, 'studentId and relationship are required');
  const link = await guardianModel.linkToStudent(req.user.school_id, {
    studentId, guardianId: req.params.id, relationship, isPrimaryContact,
  });
  return sendSuccess(res, 200, link, 'Guardian linked to student');
});

const listGuardianStudents = asyncHandler(async (req, res) => {
  const students = await guardianModel.listStudentsByGuardian(req.user.school_id, req.params.id);
  return sendSuccess(res, 200, students);
});

const listStudentGuardians = asyncHandler(async (req, res) => {
  const guardians = await guardianModel.listByStudent(req.user.school_id, req.params.studentId);
  return sendSuccess(res, 200, guardians);
});

const unlinkGuardian = asyncHandler(async (req, res) => {
  const result = await guardianModel.unlinkFromStudent(req.user.school_id, req.params.studentId, req.params.id);
  if (!result) throw new ApiError(404, 'Link not found');
  return sendSuccess(res, 200, result, 'Guardian unlinked');
});

module.exports = {
  createGuardian, searchGuardians, getGuardian, linkGuardianToStudent,
  listGuardianStudents, listStudentGuardians, unlinkGuardian,
};
