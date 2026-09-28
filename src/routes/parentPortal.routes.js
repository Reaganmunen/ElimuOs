const express = require('express');
const {
  listMyChildren, getChild, getChildReportCard, downloadChildReportCardPdf,
  getChildAttendance, listChildInvoices, getChildInvoice,
  getMe, updateMe, changePassword, getSummary,
  getChildTimetable, getChildAttendanceRecords, getChildTeachers, listChildPayments,
  listChildInvoiceTransactions, getChildFeeStatement,
  listChildAbsenceReports, createChildAbsenceReport, cancelChildAbsenceReport,
  listMessages, getUnreadCount, markMessageRead, markAllMessagesRead,
  listEnquiries, createEnquiry, markEnquirySeen,
} = require('../controllers/parentPortal.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');
const ApiError = require('../utils/ApiError');
const guardianModel = require('../models/guardian.model');

const router = express.Router();

router.use(authenticate, restrictTo('parent'));

/**
 * Runs once for every route below that has a :studentId segment, BEFORE
 * that route's own handler. This is the enforcement point for the entire
 * parent portal: it's structurally impossible to add a new child-scoped
 * route here and forget the ownership check, because Express calls this
 * regardless of which specific handler ends up running.
 */
router.param('studentId', async (req, res, next, studentId) => {
  try {
    const guardian = await guardianModel.findByUserId(req.user.school_id, req.user.id);
    if (!guardian) {
      throw new ApiError(404, 'No guardian record is linked to this account');
    }
    const owns = await guardianModel.isGuardianOfStudent(req.user.school_id, req.user.id, studentId);
    if (!owns) {
      // 404, not 403 — confirming "this student exists but isn't yours"
      // vs "this student doesn't exist" would let a parent enumerate
      // other families' student IDs by watching which ones return 403
      // vs 404. Same reasoning as login's identical error for bad email
      // vs bad password.
      throw new ApiError(404, 'Student not found');
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ----- Guardian-level (not tied to one child) -----
router.get('/summary', getSummary);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.post('/me/change-password', changePassword);

router.get('/messages', listMessages);
router.get('/messages/unread-count', getUnreadCount);
router.post('/messages/read-all', markAllMessagesRead);
router.post('/messages/:messageId/read', markMessageRead);

router.get('/enquiries', listEnquiries);
router.post('/enquiries', createEnquiry);
router.post('/enquiries/:enquiryId/seen', markEnquirySeen);

// ----- Child-scoped (ownership enforced by router.param above) -----
router.get('/children', listMyChildren);
router.get('/children/:studentId', getChild);
router.get('/children/:studentId/report-card/:termId', getChildReportCard);
router.get('/children/:studentId/report-card/:termId/pdf', downloadChildReportCardPdf);
router.get('/children/:studentId/attendance', getChildAttendance);
router.get('/children/:studentId/invoices', listChildInvoices);
router.get('/children/:studentId/invoices/:invoiceId', getChildInvoice);
router.get('/children/:studentId/invoices/:invoiceId/transactions', listChildInvoiceTransactions);
router.get('/children/:studentId/timetable', getChildTimetable);
router.get('/children/:studentId/attendance/records', getChildAttendanceRecords);
router.get('/children/:studentId/teachers', getChildTeachers);
router.get('/children/:studentId/payments', listChildPayments);
router.get('/children/:studentId/fee-statement', getChildFeeStatement);
router.get('/children/:studentId/absence-reports', listChildAbsenceReports);
router.post('/children/:studentId/absence-reports', createChildAbsenceReport);
router.delete('/children/:studentId/absence-reports/:reportId', cancelChildAbsenceReport);

module.exports = router;