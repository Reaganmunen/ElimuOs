const express = require('express');
const {
  createGuardian, searchGuardians, getGuardian, linkGuardianToStudent, listGuardianStudents,
} = require('../controllers/guardian.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createGuardian);
router.get('/', restrictTo('school_admin', 'accountant'), searchGuardians);
router.get('/:id', restrictTo('school_admin', 'accountant'), getGuardian);
router.get('/:id/students', restrictTo('school_admin', 'accountant'), listGuardianStudents);
router.post('/:id/link-student', restrictTo('school_admin'), linkGuardianToStudent);

module.exports = router;
