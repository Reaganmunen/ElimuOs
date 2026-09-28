const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const portalModel = require('../models/guardianPortal.model');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTeacher = (req) => req.user.role === 'teacher';

/**
 * Who sees what:
 *   school_admin → every notice and enquiry in the school; can forward enquiries.
 *   teacher      → absence notices for students in classes they are class teacher of,
 *                  and only the enquiries an admin has forwarded to them.
 */

// Absence / late / early-pickup notices guardians have submitted.
const listAbsenceReports = asyncHandler(async (req, res) => {
  const { date, status, classId, limit, offset } = req.query;
  if (date && !isDate(date)) throw new ApiError(400, 'date must be YYYY-MM-DD');
  if (status && !['submitted', 'acknowledged'].includes(status)) throw new ApiError(400, 'Invalid status filter');
  const rows = await portalModel.listAbsenceReportsForStaff(req.user.school_id, {
    date, status, classId, teacherId: isTeacher(req) ? req.user.id : null,
    limit: Math.min(Number(limit) || 100, 300), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, rows);
});

const acknowledgeAbsenceReport = asyncHandler(async (req, res) => {
  const note = req.body.staffNote ? String(req.body.staffNote).trim().slice(0, 500) : null;
  const row = await portalModel.acknowledgeAbsenceReport(req.user.school_id, {
    reportId: req.params.id, userId: req.user.id, staffNote: note, teacherId: isTeacher(req) ? req.user.id : null,
  });
  if (!row) throw new ApiError(404, 'Notice not found, or it was already acknowledged or withdrawn');
  return sendSuccess(res, 200, row, 'Notice acknowledged');
});

const listEnquiries = asyncHandler(async (req, res) => {
  const { status, assigned, limit, offset } = req.query;
  if (status && !['open', 'answered', 'closed'].includes(status)) throw new ApiError(400, 'Invalid status filter');
  if (assigned && !['unassigned', 'forwarded'].includes(assigned)) throw new ApiError(400, 'Invalid assigned filter');
  const rows = await portalModel.listEnquiriesForStaff(req.user.school_id, {
    status, assigned, assignedTo: isTeacher(req) ? req.user.id : null,
    limit: Math.min(Number(limit) || 100, 300), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, rows);
});

const replyToEnquiry = asyncHandler(async (req, res) => {
  const reply = String(req.body.reply || '').trim();
  if (reply.length < 2 || reply.length > 2000) throw new ApiError(400, 'reply must be 2–2000 characters');
  const row = await portalModel.replyToEnquiry(req.user.school_id, {
    enquiryId: req.params.id, userId: req.user.id, reply, assignedTo: isTeacher(req) ? req.user.id : null,
  });
  if (!row) throw new ApiError(404, 'Enquiry not found');
  return sendSuccess(res, 200, row, 'Reply sent');
});

// Admin only (enforced in the router).
const listForwardTargets = asyncHandler(async (req, res) => {
  const enq = await portalModel.getEnquiryForStaff(req.user.school_id, req.params.id);
  if (!enq) throw new ApiError(404, 'Enquiry not found');
  return sendSuccess(res, 200, await portalModel.listForwardTargets(req.user.school_id, req.params.id));
});

const forwardEnquiry = asyncHandler(async (req, res) => {
  const teacherId = req.body.teacherId;
  if (!teacherId) throw new ApiError(400, 'teacherId is required');
  const note = req.body.note ? String(req.body.note).trim().slice(0, 500) : null;
  let row;
  try {
    row = await portalModel.forwardEnquiry(req.user.school_id, {
      enquiryId: req.params.id, teacherId, forwardedBy: req.user.id, note,
    });
  } catch (err) {
    if (err.message === 'INVALID_TEACHER') throw new ApiError(400, 'That person is not an active teacher at this school');
    throw err;
  }
  if (!row) throw new ApiError(404, 'Enquiry not found');
  return sendSuccess(res, 200, await portalModel.getEnquiryForStaff(req.user.school_id, req.params.id), 'Enquiry forwarded');
});

const unassignEnquiry = asyncHandler(async (req, res) => {
  const row = await portalModel.unassignEnquiry(req.user.school_id, req.params.id);
  if (!row) throw new ApiError(404, 'Enquiry not found');
  return sendSuccess(res, 200, await portalModel.getEnquiryForStaff(req.user.school_id, req.params.id), 'Enquiry taken back');
});

// Badge counts for the nav / tabs.
const summary = asyncHandler(async (req, res) =>
  sendSuccess(res, 200, await portalModel.staffSummary(req.user.school_id, { teacherId: isTeacher(req) ? req.user.id : null })));

module.exports = {
  listAbsenceReports, acknowledgeAbsenceReport, listEnquiries, replyToEnquiry,
  listForwardTargets, forwardEnquiry, unassignEnquiry, summary,
};
