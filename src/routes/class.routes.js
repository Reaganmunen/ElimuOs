const express = require('express');
const {
  createClass, listClasses, getClass, updateClass, listClassStudents,
} = require('../controllers/class.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// Staff-only: a class roster is full student PII (name, admission
// number, DOB, gender). parent/student have their own sanctioned path
// (the parent portal's ownership-checked routes) — they should never be
// able to reach a class roster directly, which this router previously
// allowed for every one of these routes.
router.post('/', restrictTo('school_admin'), createClass);
router.get('/', restrictTo('school_admin', 'teacher', 'accountant'), listClasses);
router.get('/:id', restrictTo('school_admin', 'teacher', 'accountant'), getClass);
router.patch('/:id', restrictTo('school_admin'), updateClass);
router.get('/:id/students', restrictTo('school_admin', 'teacher', 'accountant'), listClassStudents);

module.exports = router;
