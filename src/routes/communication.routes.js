const express = require('express');
const { createTemplate, listTemplates, sendBroadcast, getMessage } = require('../controllers/communication.controller');
const { getSettings, updateSettings, sendTest } = require('../controllers/messagingSettings.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');
const { testSendLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/templates', restrictTo('school_admin'), createTemplate);
router.get('/templates', restrictTo('school_admin'), listTemplates);

// Per-school sender setup (own SMS/SMTP accounts, sender identity)
router.get('/settings', restrictTo('school_admin'), getSettings);
router.put('/settings', restrictTo('school_admin'), updateSettings);
router.post('/settings/test', restrictTo('school_admin'), testSendLimiter, sendTest);

router.post('/send', restrictTo('school_admin', 'teacher'), sendBroadcast);
router.get('/messages/:id', restrictTo('school_admin', 'teacher'), getMessage);

module.exports = router;