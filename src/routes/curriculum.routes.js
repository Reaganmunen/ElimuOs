const express = require('express');
const {
  getEducationLevels, getGrades, getLearningAreas, getStrands,
  getSubStrands, getLearningOutcomes, getRubricLevels, getGradeTree,
} = require('../controllers/curriculum.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/education-levels', getEducationLevels);
router.get('/grades', getGrades);
router.get('/grades/:gradeId/learning-areas', getLearningAreas);
router.get('/grades/:gradeId/tree', getGradeTree);
router.get('/learning-areas/:learningAreaId/strands', getStrands);
router.get('/strands/:strandId/sub-strands', getSubStrands);
router.get('/sub-strands/:subStrandId/learning-outcomes', getLearningOutcomes);
router.get('/rubric-levels', getRubricLevels);

module.exports = router;
