const express = require('express');
const { createUser, listUsers, getUser } = require('../controllers/user.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', restrictTo('school_admin'), createUser);
router.get('/', restrictTo('school_admin'), listUsers);
router.get('/:id', restrictTo('school_admin'), getUser);

module.exports = router;
