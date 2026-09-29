const express = require('express');
const {
  initiatePayment, handleCallback, listTransactions, listInvoiceTransactions,
  getPaymentConfig, updatePaymentConfig, verifyCredentials, registerC2b,
} = require('../controllers/mpesa.controller');
const {
  listC2B, allocateC2B, ignoreC2B, listB2B, sendB2B,
} = require('../controllers/mpesaDirect.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');
const { credentialActionLimiter, b2bSendLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

// Public - the ORIGINAL STK callback address, kept so any prompt already sent
// before this update still reports back. New prompts use /api/v1/pay/stk/callback
// (Safaricom filters URLs containing "mpesa"). Must stay before authenticate.
router.post('/callback', handleCallback);

router.use(authenticate);

// STK Push
router.post('/stk-push', restrictTo('school_admin', 'accountant', 'parent'), initiatePayment);
router.get('/transactions', restrictTo('school_admin', 'accountant'), listTransactions);
router.get('/invoices/:invoiceId/transactions', restrictTo('school_admin', 'accountant'), listInvoiceTransactions);

// Payment setup
router.get('/config', restrictTo('school_admin'), getPaymentConfig);
router.patch('/config', restrictTo('school_admin'), updatePaymentConfig);
router.post('/config/verify', restrictTo('school_admin'), credentialActionLimiter, verifyCredentials);
router.post('/config/c2b/register', restrictTo('school_admin'), credentialActionLimiter, registerC2b);

// C2B - customers paying the paybill / till directly
router.get('/c2b/transactions', restrictTo('school_admin', 'accountant'), listC2B);
router.post('/c2b/transactions/:id/allocate', restrictTo('school_admin', 'accountant'), allocateC2B);
router.post('/c2b/transactions/:id/ignore', restrictTo('school_admin', 'accountant'), ignoreC2B);

// B2B - the school paying another paybill / till (moves money OUT: admin only)
router.get('/b2b/transactions', restrictTo('school_admin'), listB2B);
router.post('/b2b/send', restrictTo('school_admin'), b2bSendLimiter, sendB2B);

module.exports = router;
