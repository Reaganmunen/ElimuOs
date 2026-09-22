const express = require('express');
const {
  getMe, getMyReportCard, downloadMyReportCardPdf, getMyAttendance, listMyInvoices, getMyInvoice,
} = require('../controllers/studentPortal.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate, restrictTo('student'));

router.get('/me', getMe);
router.get('/me/terms/:termId/report-card', getMyReportCard);
router.get('/me/terms/:termId/report-card/pdf', downloadMyReportCardPdf);
router.get('/me/attendance', getMyAttendance);
router.get('/me/invoices', listMyInvoices);
router.get('/me/invoices/:invoiceId', getMyInvoice);

module.exports = router;
