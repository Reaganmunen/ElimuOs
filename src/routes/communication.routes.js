const express = require('express');
const { createTemplate, listTemplates, sendBroadcast, getMessage } = require('../controllers/communication.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/templates', restrictTo('school_admin'), createTemplate);
router.get('/templates', restrictTo('school_admin'), listTemplates);

router.post('/send', restrictTo('school_admin', 'teacher'), sendBroadcast);
router.get('/messages/:id', restrictTo('school_admin', 'teacher'), getMessage);

module.exports = router;
