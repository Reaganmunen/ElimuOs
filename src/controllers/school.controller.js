const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const schoolModel = require('../models/school.model');

// super_admin only — lists all tenants on the platform
const listSchools = asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const schools = await schoolModel.list({ limit: Number(limit) || 50, offset: Number(offset) || 0 });
  return sendSuccess(res, 200, schools);
});

const getMySchool = asyncHandler(async (req, res) => {
  const school = await schoolModel.findById(req.user.school_id);
  if (!school) throw new ApiError(404, 'School not found');
  return sendSuccess(res, 200, school);
});

const updateMySchool = asyncHandler(async (req, res) => {
  const updated = await schoolModel.update(req.user.school_id, req.body);
  if (!updated) throw new ApiError(404, 'School not found');
  return sendSuccess(res, 200, updated, 'School profile updated');
});

module.exports = { listSchools, getMySchool, updateMySchool };
