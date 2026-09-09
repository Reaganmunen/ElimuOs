const express = require('express');
const {
  createStudent, getStudent, searchStudents, updateStudent, transferStudentClass, withdrawStudent,
} = require('../controllers/student.controller');
const { listStudentGuardians, unlinkGuardian } = require('../controllers/guardian.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createStudent);
router.get('/', restrictTo('school_admin', 'teacher', 'accountant'), searchStudents);
router.get('/:id', restrictTo('school_admin', 'teacher', 'accountant'), getStudent);
router.patch('/:id', restrictTo('school_admin'), updateStudent);
router.patch('/:id/transfer-class', restrictTo('school_admin'), transferStudentClass);
router.delete('/:id', restrictTo('school_admin'), withdrawStudent);

router.get('/:studentId/guardians', restrictTo('school_admin', 'accountant'), listStudentGuardians);
router.delete('/:studentId/guardians/:id', restrictTo('school_admin'), unlinkGuardian);

module.exports = router;
