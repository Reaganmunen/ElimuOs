const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const staffProfileModel = require('../models/staffProfile.model');
const userModel = require('../models/user.model');

const upsertProfile = asyncHandler(async (req, res) => {
  const { tscNumber, employmentDate, designation } = req.body;
  try {
    const profile = await staffProfileModel.upsert(req.user.school_id, req.params.userId, {
      tscNumber, employmentDate, designation,
    }, req.user.id);
    return sendSuccess(res, 200, profile, 'Staff profile saved');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await staffProfileModel.getByUserId(req.user.school_id, req.params.userId);
  if (!profile) throw new ApiError(404, 'Staff profile not found');
  return sendSuccess(res, 200, profile);
});

const listStaff = asyncHandler(async (req, res) => {
  const { roleCode, limit, offset } = req.query;
  const staff = await staffProfileModel.listBySchool(req.user.school_id, {
    roleCode, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, staff);
});

// Removing a staff profile is an offboarding action, not just a metadata
// deletion — the admin expects the login to stop working too. We
// deactivate rather than delete the user row, so audit_logs / payments /
// attendance_records recorded_by/received_by foreign keys stay intact.
const removeProfile = asyncHandler(async (req, res) => {
  const result = await staffProfileModel.remove(req.user.school_id, req.params.userId);
  if (!result) throw new ApiError(404, 'Staff profile not found');

  try {
    await userModel.deactivate(req.user.school_id, req.params.userId, req.user.id);
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  return sendSuccess(res, 200, result, 'Staff member removed and account deactivated');
});

module.exports = { upsertProfile, getProfile, listStaff, removeProfile };