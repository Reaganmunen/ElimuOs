const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const studentModel = require('../models/student.model');
const userModel = require('../models/user.model');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');

const createStudent = asyncHandler(async (req, res) => {
  const { admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId } = req.body;
  if (!admissionNumber || !fullName) {
    throw new ApiError(400, 'admissionNumber and fullName are required');
  }
  const student = await studentModel.create(req.user.school_id, {
    admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId,
  }, req.user.id);
  return sendSuccess(res, 201, student, 'Student created');
});

const getStudent = asyncHandler(async (req, res) => {
  const student = await studentModel.findById(req.user.school_id, req.params.id);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student);
});

const searchStudents = asyncHandler(async (req, res) => {
  const { q, status, limit, offset } = req.query;
  const students = await studentModel.search(req.user.school_id, {
    q, status, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, students);
});

const updateStudent = asyncHandler(async (req, res) => {
  const student = await studentModel.update(req.user.school_id, req.params.id, req.body, req.user.id);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student, 'Student updated');
});

const transferStudentClass = asyncHandler(async (req, res) => {
  const { newClassId } = req.body;
  if (!newClassId) throw new ApiError(400, 'newClassId is required');
  const student = await studentModel.transferClass(req.user.school_id, req.params.id, newClassId, req.user.id);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student, 'Student transferred to new class');
});

const withdrawStudent = asyncHandler(async (req, res) => {
  const result = await studentModel.softDelete(req.user.school_id, req.params.id, req.user.id);
  if (!result) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, result, 'Student withdrawn');
});

/**
 * Creates a portal login for an existing student and links it in one
 * step — same pattern as the guardian portal-account endpoint. Most
 * students won't get one of these; it's opt-in per student, typically for
 * older learners.
 */
const createPortalAccount = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'email and password are required');
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new ApiError(400, passwordError);

  const student = await studentModel.findById(req.user.school_id, req.params.id);
  if (!student) throw new ApiError(404, 'Student not found');
  if (student.user_id) throw new ApiError(409, 'This student already has a portal account');

  const user = await userModel.create({
    schoolId: req.user.school_id, fullName: student.full_name, email, password, roleCode: 'student',
  }, req.user.id);

  const linked = await studentModel.linkUserAccount(req.user.school_id, req.params.id, user.id);
  return sendSuccess(res, 201, linked, 'Portal account created and linked');
});

module.exports = {
  createStudent, getStudent, searchStudents, updateStudent, transferStudentClass, withdrawStudent, createPortalAccount,
};