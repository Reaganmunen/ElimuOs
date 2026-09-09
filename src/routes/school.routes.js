const express = require('express');
const { listSchools, getMySchool, updateMySchool } = require('../controllers/school.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', restrictTo('super_admin'), listSchools);
router.get('/me', getMySchool);
router.patch('/me', restrictTo('school_admin'), updateMySchool);

module.exports = router;
