const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const guardianModel = require('../models/guardian.model');
const userModel = require('../models/user.model');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');

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

/**
 * Creates a portal login for an existing guardian and links it in one
 * step. This is the piece that was missing entirely before — a guardian
 * record with no way to ever log in. roleCode is fixed to 'parent' here
 * rather than accepted from the request, since this endpoint's whole
 * purpose is specifically "give this guardian parent-portal access."
 */
const createPortalAccount = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'email and password are required');
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new ApiError(400, passwordError);

  const guardian = await guardianModel.findById(req.user.school_id, req.params.id);
  if (!guardian) throw new ApiError(404, 'Guardian not found');
  if (guardian.user_id) throw new ApiError(409, 'This guardian already has a portal account');

  const user = await userModel.create({
    schoolId: req.user.school_id, fullName: guardian.full_name, email, password, roleCode: 'parent',
  }, req.user.id);

  const linked = await guardianModel.linkUserAccount(req.user.school_id, req.params.id, user.id);
  return sendSuccess(res, 201, linked, 'Portal account created and linked');
});

module.exports = {
  createGuardian, searchGuardians, getGuardian, linkGuardianToStudent,
  listGuardianStudents, listStudentGuardians, unlinkGuardian, createPortalAccount,
};