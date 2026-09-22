const express = require('express');
const { createUser, listUsers, getUser, getMyLanding } = require('../controllers/user.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createUser);
router.get('/', restrictTo('school_admin'), listUsers);
// Any authenticated role — this just describes what the caller has
// access to, gated implicitly by req.user rather than by role. Placed
// before /:id so it's never shadowed (Express matches /me/landing as a
// distinct two-segment path anyway, but keeping it here documents intent).
router.get('/me/landing', getMyLanding);
router.get('/:id', restrictTo('school_admin'), getUser);

module.exports = router;
