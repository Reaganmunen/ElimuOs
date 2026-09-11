const express = require('express');
const {
  listMyChildren, getChild, getChildReportCard, downloadChildReportCardPdf,
  getChildAttendance, listChildInvoices, getChildInvoice,
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

router.get('/children', listMyChildren);
router.get('/children/:studentId', getChild);
router.get('/children/:studentId/report-card/:termId', getChildReportCard);
router.get('/children/:studentId/report-card/:termId/pdf', downloadChildReportCardPdf);
router.get('/children/:studentId/attendance', getChildAttendance);
router.get('/children/:studentId/invoices', listChildInvoices);
router.get('/children/:studentId/invoices/:invoiceId', getChildInvoice);

module.exports = router;