const express = require('express');
const {
  registerSchool, login, getCurrentUser, forgotPassword, resetPassword,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { loginLimiter, sensitiveActionLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.post('/register-school', sensitiveActionLimiter, registerSchool);
router.post('/login', loginLimiter, login);
router.post('/forgot-password', sensitiveActionLimiter, forgotPassword);
router.post('/reset-password', sensitiveActionLimiter, resetPassword);
router.get('/me', authenticate, getCurrentUser);

module.exports = router;