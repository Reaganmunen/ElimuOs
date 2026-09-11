const express = require('express');
const { listMySchoolLogs, getRecordHistory, listAllLogs } = require('../controllers/auditLog.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', restrictTo('school_admin'), listMySchoolLogs);
router.get('/record/:tableName/:recordId', restrictTo('school_admin'), getRecordHistory);
router.get('/all', restrictTo('super_admin'), listAllLogs);

module.exports = router;