const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const studentModel = require('../models/student.model');

const createStudent = asyncHandler(async (req, res) => {
  const { admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId } = req.body;
  if (!admissionNumber || !fullName) {
    throw new ApiError(400, 'admissionNumber and fullName are required');
  }
  const student = await studentModel.create(req.user.school_id, {
    admissionNumber, fullName, dateOfBirth, gender, upiNumber, currentClassId,
  });
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
  const student = await studentModel.update(req.user.school_id, req.params.id, req.body);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student, 'Student updated');
});

const transferStudentClass = asyncHandler(async (req, res) => {
  const { newClassId } = req.body;
  if (!newClassId) throw new ApiError(400, 'newClassId is required');
  const student = await studentModel.transferClass(req.user.school_id, req.params.id, newClassId);
  if (!student) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, student, 'Student transferred to new class');
});

const withdrawStudent = asyncHandler(async (req, res) => {
  const result = await studentModel.softDelete(req.user.school_id, req.params.id);
  if (!result) throw new ApiError(404, 'Student not found');
  return sendSuccess(res, 200, result, 'Student withdrawn');
});

module.exports = {
  createStudent, getStudent, searchStudents, updateStudent, transferStudentClass, withdrawStudent,
};
