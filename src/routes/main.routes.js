const express = require('express');

const authRoutes = require('./auth.routes');
const schoolRoutes = require('./school.routes');
const userRoutes = require('./user.routes');
const academicYearRoutes = require('./academicYear.routes');
const classRoutes = require('./class.routes');
const studentRoutes = require('./student.routes');
const curriculumRoutes = require('./curriculum.routes');
const guardianRoutes = require('./guardian.routes');
const teachingRoutes = require('./teaching.routes');
const attendanceRoutes = require('./attendance.routes');
const assessmentRoutes = require('./assessment.routes');
const feeRoutes = require('./fee.routes');
const mpesaRoutes = require('./mpesa.routes');
const communicationRoutes = require('./communication.routes');
const staffRoutes = require('./staff.routes');
const billingRoutes = require('./billing.routes');
const auditLogRoutes = require('./auditLog.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/schools', schoolRoutes);
router.use('/users', userRoutes);
router.use('/academic-years', academicYearRoutes);
router.use('/classes', classRoutes);
router.use('/students', studentRoutes);
router.use('/curriculum', curriculumRoutes);
router.use('/guardians', guardianRoutes);
router.use('/teaching', teachingRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/fees', feeRoutes);
router.use('/mpesa', mpesaRoutes);
router.use('/communications', communicationRoutes);
router.use('/staff', staffRoutes);
router.use('/billing', billingRoutes);
router.use('/audit-logs', auditLogRoutes);

module.exports = router;