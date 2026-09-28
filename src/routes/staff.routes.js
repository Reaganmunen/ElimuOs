const express = require('express');
const { upsertProfile, getProfile, getMyProfile, listStaff, removeProfile } = require('../controllers/staffProfile.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', restrictTo('school_admin'), listStaff);
// No restrictTo — any authenticated staff member can read their own
// profile. Must come before /:userId/profile below, or Express would
// match "me" as a userId and hit the school_admin-only handler instead.
router.get('/me/profile', getMyProfile);
router.put('/:userId/profile', restrictTo('school_admin'), upsertProfile);
router.get('/:userId/profile', restrictTo('school_admin'), getProfile);
router.delete('/:userId/profile', restrictTo('school_admin'), removeProfile);

module.exports = router;