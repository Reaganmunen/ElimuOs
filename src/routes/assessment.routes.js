const express = require('express');
const {
  createAssessment, recordResults, getAssessmentResults, getStudentTermResults,
  generateReportCard, getReportCard, downloadReportCardPdf,
} = require('../controllers/assessment.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('teacher', 'school_admin'), createAssessment);
router.post('/:id/results', restrictTo('teacher', 'school_admin'), recordResults);
router.get('/:id/results', restrictTo('teacher', 'school_admin'), getAssessmentResults);

router.get('/students/:studentId/terms/:termId', restrictTo('teacher', 'school_admin'), getStudentTermResults);
router.post('/students/:studentId/terms/:termId/report-card', restrictTo('teacher', 'school_admin'), generateReportCard);
router.get('/students/:studentId/terms/:termId/report-card', restrictTo('teacher', 'school_admin', 'accountant'), getReportCard);
router.get('/students/:studentId/terms/:termId/report-card/pdf', restrictTo('teacher', 'school_admin', 'accountant'), downloadReportCardPdf);

module.exports = router;