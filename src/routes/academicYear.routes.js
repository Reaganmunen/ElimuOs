const express = require('express');
const {
  createAcademicYear, listAcademicYears, setCurrentAcademicYear, createTerm, listTerms,
} = require('../controllers/academicYear.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createAcademicYear);
router.get('/', listAcademicYears);
router.patch('/:id/set-current', restrictTo('school_admin'), setCurrentAcademicYear);

router.post('/:id/terms', restrictTo('school_admin'), createTerm);
router.get('/:id/terms', listTerms);

module.exports = router;
