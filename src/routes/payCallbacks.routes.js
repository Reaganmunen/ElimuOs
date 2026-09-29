const express = require('express');
const { handleCallback } = require('../controllers/mpesa.controller');
const { c2bValidation, c2bConfirmation, b2bResult, b2bTimeout } = require('../controllers/mpesaDirect.controller');

/**
 * PUBLIC endpoints that Safaricom's servers call - deliberately NO
 * `authenticate` here (Safaricom has no JWT).
 *
 * Mounted at /api/v1/pay. The word "mpesa" is intentionally absent from
 * every path: Safaricom blocks callback URLs containing "mpesa"/"safaricom".
 *
 * The :token segment is the school's secret callback token - it is what proves
 * a C2B/B2B callback belongs to that school (Safaricom doesn't sign them).
 */
const router = express.Router();

router.post('/stk/callback', handleCallback);

router.post('/c2b/:token/validation', c2bValidation);
router.post('/c2b/:token/confirmation', c2bConfirmation);

router.post('/b2b/:token/result', b2bResult);
router.post('/b2b/:token/timeout', b2bTimeout);

module.exports = router;
