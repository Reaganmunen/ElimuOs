const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const auditLogModel = require('../models/auditLog.model');

const listMySchoolLogs = asyncHandler(async (req, res) => {
  const { tableName, userId, action, limit, offset } = req.query;
  const logs = await auditLogModel.listBySchool(req.user.school_id, {
    tableName, userId, action, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, logs);
});

const getRecordHistory = asyncHandler(async (req, res) => {
  const { tableName, recordId } = req.params;
  const logs = await auditLogModel.getForRecord(req.user.school_id, tableName, recordId);
  return sendSuccess(res, 200, logs);
});

// super_admin — platform-wide, cross-tenant view
const listAllLogs = asyncHandler(async (req, res) => {
  const { schoolId, tableName, action, limit, offset } = req.query;
  const logs = await auditLogModel.listAll({
    schoolId, tableName, action, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, logs);
});

module.exports = { listMySchoolLogs, getRecordHistory, listAllLogs };