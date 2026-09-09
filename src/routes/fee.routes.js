const express = require('express');
const {
  createFeeStructure, listFeeStructures, deleteFeeStructure,
  generateInvoice, getInvoice, listStudentInvoices, listOutstandingInvoices,
  recordPayment, listInvoicePayments, listStudentPayments, voidPayment,
} = require('../controllers/fee.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// Fee structures
router.post('/structures', restrictTo('school_admin', 'accountant'), createFeeStructure);
router.get('/structures', restrictTo('school_admin', 'accountant'), listFeeStructures);
router.delete('/structures/:id', restrictTo('school_admin'), deleteFeeStructure);

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

module.exports = router;
