const express = require('express');
const {
  createPlan, listPlans, updatePlan, setPlanActive,
  startTrial, getMySubscription, cancelMySubscription, changeMyPlan,
  listAllSubscriptions, activateSubscription, expireTrials,
} = require('../controllers/billing.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

// Plans — any authenticated role can browse (needed to pick one before subscribing)
router.get('/plans', listPlans);
router.post('/plans', restrictTo('super_admin'), createPlan);
router.patch('/plans/:id', restrictTo('super_admin'), updatePlan);
router.patch('/plans/:id/active', restrictTo('super_admin'), setPlanActive);

// A school's own subscription
router.post('/subscriptions/start-trial', restrictTo('school_admin'), startTrial);
router.get('/subscriptions/mine', restrictTo('school_admin', 'accountant'), getMySubscription);
router.post('/subscriptions/mine/cancel', restrictTo('school_admin'), cancelMySubscription);
router.patch('/subscriptions/mine/plan', restrictTo('school_admin'), changeMyPlan);

// Platform-level, cross-tenant
router.get('/subscriptions', restrictTo('super_admin'), listAllSubscriptions);
router.post('/subscriptions/:id/activate', restrictTo('super_admin'), activateSubscription);
router.post('/subscriptions/expire-trials', restrictTo('super_admin'), expireTrials);

module.exports = router;