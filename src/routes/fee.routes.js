const express = require('express');
const {
  createFeeStructure, listFeeStructures, updateFeeStructure, deleteFeeStructure,
  generateInvoice, getInvoice, listStudentInvoices, listOutstandingInvoices,
  recordPayment, listInvoicePayments, listStudentPayments, voidPayment,
  listAllInvoices, getFeeSummary, listLedger,
} = require('../controllers/fee.controller');
const {
  applyAdjustment, reverseAdjustment, refundInvoice, carryArrears, listFamilies, copyFeeStructures,
} = require('../controllers/feeExtras.controller');
const { sendReminders } = require('../controllers/feeReminder.controller');
const { reminderLimiter } = require('../middleware/rateLimiter.middleware');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// Fee structures
router.post('/structures', restrictTo('school_admin', 'accountant'), createFeeStructure);
router.get('/structures', restrictTo('school_admin', 'accountant'), listFeeStructures);
router.post('/structures/copy', restrictTo('school_admin', 'accountant'), copyFeeStructures);
router.patch('/structures/:id', restrictTo('school_admin', 'accountant'), updateFeeStructure);
router.delete('/structures/:id', restrictTo('school_admin', 'accountant'), deleteFeeStructure);

// Invoices
router.post('/invoices', restrictTo('school_admin', 'accountant'), generateInvoice);
router.get('/invoices/outstanding', restrictTo('school_admin', 'accountant'), listOutstandingInvoices);
router.get('/invoices/:id', restrictTo('school_admin', 'accountant'), getInvoice);
router.get('/invoices/student/:studentId', restrictTo('school_admin', 'accountant'), listStudentInvoices);
router.get('/invoices/:invoiceId/payments', restrictTo('school_admin', 'accountant'), listInvoicePayments);

// Manual payments
router.post('/payments', restrictTo('school_admin', 'accountant'), recordPayment);
router.post('/payments/:id/void', restrictTo('school_admin', 'accountant'), voidPayment);
router.get('/payments/student/:studentId', restrictTo('school_admin', 'accountant'), listStudentPayments);

// Discounts / bursaries, refunds, arrears, families
router.post('/invoices/:id/adjustments', restrictTo('school_admin', 'accountant'), applyAdjustment);
router.post('/adjustments/:id/reverse', restrictTo('school_admin', 'accountant'), reverseAdjustment);
router.post('/invoices/:id/refund', restrictTo('school_admin', 'accountant'), refundInvoice);
router.post('/arrears/carry', restrictTo('school_admin', 'accountant'), carryArrears);
router.get('/families', restrictTo('school_admin', 'accountant'), listFamilies);

// Reporting + reminders
router.get('/invoices', restrictTo('school_admin', 'accountant'), listAllInvoices);
router.get('/summary', restrictTo('school_admin', 'accountant'), getFeeSummary);
router.get('/payments', restrictTo('school_admin', 'accountant'), listLedger);
router.post('/reminders', restrictTo('school_admin', 'accountant'), reminderLimiter, sendReminders);

module.exports = router;