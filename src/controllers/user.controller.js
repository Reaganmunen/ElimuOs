const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const userModel = require('../models/user.model');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');

const createUser = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, roleCode } = req.body;
  if (!fullName || !email || !password || !roleCode) {
    throw new ApiError(400, 'fullName, email, password and roleCode are required');
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new ApiError(400, passwordError);

  const user = await userModel.create({ schoolId: req.user.school_id, fullName, email, phone, password, roleCode });
  return sendSuccess(res, 201, user, 'User created');
});

const listUsers = asyncHandler(async (req, res) => {
  const { roleCode, limit, offset } = req.query;
  const users = await userModel.listBySchool(req.user.school_id, {
    roleCode,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, users);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.params.id, req.user.school_id);
  if (!user) throw new ApiError(404, 'User not found');
  return sendSuccess(res, 200, user);
});

module.exports = { createUser, listUsers, getUser };