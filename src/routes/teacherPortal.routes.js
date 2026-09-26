const express = require('express');
const {
  getOverview, getGradeSheet, saveGrades, getPerformance, getClassGuardians,
} = require('../controllers/teacherPortal.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Teacher-only. Per-class permissions (class teacher vs. subject teacher) are
// enforced in the controller, since they depend on the class in the URL.
router.use(authenticate, restrictTo('teacher'));

router.get('/overview', getOverview);
router.get('/classes/:classId/grade-sheet', getGradeSheet);
router.post('/classes/:classId/grades', saveGrades);
router.get('/classes/:classId/performance', getPerformance);
router.get('/classes/:classId/guardians', getClassGuardians);

module.exports = router;
