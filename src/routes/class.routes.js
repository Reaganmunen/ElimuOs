const express = require('express');
const {
  createClass, listClasses, getClass, updateClass, listClassStudents,
} = require('../controllers/class.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createClass);
router.get('/', listClasses);
router.get('/:id', getClass);
router.patch('/:id', restrictTo('school_admin'), updateClass);
router.get('/:id/students', listClassStudents);

module.exports = router;
