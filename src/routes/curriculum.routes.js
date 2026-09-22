const express = require('express');
const {
  getEducationLevels, getGrades, getLearningAreas, getStrands,
  getSubStrands, getLearningOutcomes, getRubricLevels, getGradeTree,
  createEducationLevel, updateEducationLevel, deleteEducationLevel,
  createGrade, updateGrade, deleteGrade,
  createLearningArea, updateLearningArea, deleteLearningArea,
  createStrand, updateStrand, deleteStrand,
  createSubStrand, updateSubStrand, deleteSubStrand,
  createLearningOutcome, updateLearningOutcome, deleteLearningOutcome,
  updateRubricLevelLabel,
} = require('../controllers/curriculum.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// Reads: every authenticated role, unchanged.
router.get('/education-levels', getEducationLevels);
router.get('/grades', getGrades);
router.get('/grades/:gradeId/learning-areas', getLearningAreas);
router.get('/grades/:gradeId/tree', getGradeTree);
router.get('/learning-areas/:learningAreaId/strands', getStrands);
router.get('/strands/:strandId/sub-strands', getSubStrands);
router.get('/sub-strands/:subStrandId/learning-outcomes', getLearningOutcomes);
router.get('/rubric-levels', getRubricLevels);

// Writes: super_admin only — this is shared, global data read by every
// school on the platform, not a per-school resource, so school_admin
// deliberately does NOT get access here. See curriculum.model.js.
router.post('/education-levels', restrictTo('super_admin'), createEducationLevel);
router.patch('/education-levels/:id', restrictTo('super_admin'), updateEducationLevel);
router.delete('/education-levels/:id', restrictTo('super_admin'), deleteEducationLevel);

router.post('/grades', restrictTo('super_admin'), createGrade);
router.patch('/grades/:id', restrictTo('super_admin'), updateGrade);
router.delete('/grades/:id', restrictTo('super_admin'), deleteGrade);

router.post('/learning-areas', restrictTo('super_admin'), createLearningArea);
router.patch('/learning-areas/:id', restrictTo('super_admin'), updateLearningArea);
router.delete('/learning-areas/:id', restrictTo('super_admin'), deleteLearningArea);

router.post('/strands', restrictTo('super_admin'), createStrand);
router.patch('/strands/:id', restrictTo('super_admin'), updateStrand);
router.delete('/strands/:id', restrictTo('super_admin'), deleteStrand);

router.post('/sub-strands', restrictTo('super_admin'), createSubStrand);
router.patch('/sub-strands/:id', restrictTo('super_admin'), updateSubStrand);
router.delete('/sub-strands/:id', restrictTo('super_admin'), deleteSubStrand);

router.post('/learning-outcomes', restrictTo('super_admin'), createLearningOutcome);
router.patch('/learning-outcomes/:id', restrictTo('super_admin'), updateLearningOutcome);
router.delete('/learning-outcomes/:id', restrictTo('super_admin'), deleteLearningOutcome);

// Label only — see curriculum.model.js updateRubricLevelLabel for why
// code/score_value are not editable here.
router.patch('/rubric-levels/:id', restrictTo('super_admin'), updateRubricLevelLabel);

module.exports = router;
