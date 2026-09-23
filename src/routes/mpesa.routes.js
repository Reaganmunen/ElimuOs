const express = require('express');
const {
  initiatePayment, handleCallback, listInvoiceTransactions, getPaymentConfig, updatePaymentConfig,
} = require('../controllers/mpesa.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Public — Daraja calls this directly, no JWT available. Must stay
// unauthenticated and must come before the router.use(authenticate) below.
router.post('/callback', handleCallback);

router.use(authenticate);

router.post('/stk-push', restrictTo('school_admin', 'accountant', 'parent'), initiatePayment);
router.get('/invoices/:invoiceId/transactions', restrictTo('school_admin', 'accountant'), listInvoiceTransactions);
router.get('/config', restrictTo('school_admin'), getPaymentConfig);
router.patch('/config', restrictTo('school_admin'), updatePaymentConfig);

module.exports = router;
