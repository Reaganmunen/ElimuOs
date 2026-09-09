const express = require('express');
const {
  markAttendance, getClassAttendance, getStudentAttendance, getStudentAttendanceSummary,
} = require('../controllers/attendance.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('teacher', 'school_admin'), markAttendance);
router.get('/class/:classId', restrictTo('teacher', 'school_admin'), getClassAttendance);
router.get('/student/:studentId', restrictTo('teacher', 'school_admin', 'accountant'), getStudentAttendance);
router.get('/student/:studentId/summary', restrictTo('teacher', 'school_admin', 'accountant'), getStudentAttendanceSummary);

module.exports = router;
