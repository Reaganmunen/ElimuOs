const express = require('express');
const { upsertProfile, getProfile, listStaff, removeProfile } = require('../controllers/staffProfile.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', restrictTo('school_admin'), listStaff);
router.put('/:userId/profile', restrictTo('school_admin'), upsertProfile);
router.get('/:userId/profile', restrictTo('school_admin'), getProfile);
router.delete('/:userId/profile', restrictTo('school_admin'), removeProfile);

module.exports = router;