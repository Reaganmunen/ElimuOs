const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const planModel = require('../models/subscriptionPlan.model');
const subscriptionModel = require('../models/schoolSubscription.model');
const studentModel = require('../models/student.model');

// -- Plans (super_admin manages, any authenticated role can view) --

const createPlan = asyncHandler(async (req, res) => {
  const { name, maxStudents, monthlyPriceKes, features } = req.body;
  if (!name || monthlyPriceKes == null) throw new ApiError(400, 'name and monthlyPriceKes are required');
  const plan = await planModel.create({ name, maxStudents, monthlyPriceKes, features });
  return sendSuccess(res, 201, plan, 'Plan created');
});

const listPlans = asyncHandler(async (req, res) => {
  const { includeInactive } = req.query;
  const plans = await planModel.list({ includeInactive: includeInactive === 'true' });
  return sendSuccess(res, 200, plans);
});

const updatePlan = asyncHandler(async (req, res) => {
  const plan = await planModel.update(req.params.id, req.body);
  if (!plan) throw new ApiError(404, 'Plan not found');
  return sendSuccess(res, 200, plan, 'Plan updated');
});

const setPlanActive = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') throw new ApiError(400, 'isActive (boolean) is required');
  const plan = await planModel.setActive(req.params.id, isActive);
  if (!plan) throw new ApiError(404, 'Plan not found');
  return sendSuccess(res, 200, plan, `Plan ${isActive ? 'reactivated' : 'retired'}`);
});

// -- Subscriptions --

const startTrial = asyncHandler(async (req, res) => {
  const { planId } = req.body;
  if (!planId) throw new ApiError(400, 'planId is required');
  const plan = await planModel.getById(planId);
  if (!plan || !plan.is_active) throw new ApiError(400, 'That plan is not available');

  try {
    const subscription = await subscriptionModel.startTrial(req.user.school_id, planId);
    return sendSuccess(res, 201, subscription, 'Trial started');
  } catch (err) {
    throw new ApiError(409, err.message);
  }
});

const getMySubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionModel.getMostRecentForSchool(req.user.school_id);
  if (!subscription) throw new ApiError(404, 'No subscription found for this school');
  return sendSuccess(res, 200, subscription);
});

const cancelMySubscription = asyncHandler(async (req, res) => {
  const live = await subscriptionModel.getLiveForSchool(req.user.school_id);
  if (!live) throw new ApiError(404, 'No live subscription to cancel');
  const cancelled = await subscriptionModel.cancel(live.id, req.user.school_id, req.user.id);
  return sendSuccess(res, 200, cancelled, 'Subscription cancelled');
});

const changeMyPlan = asyncHandler(async (req, res) => {
  const { planId } = req.body;
  if (!planId) throw new ApiError(400, 'planId is required');
  const plan = await planModel.getById(planId);
  if (!plan || !plan.is_active) throw new ApiError(400, 'That plan is not available');

  const live = await subscriptionModel.getLiveForSchool(req.user.school_id);
  if (!live) throw new ApiError(404, 'No live subscription to change');

  // max_students is nullable (an unlimited-seats plan) — only enforce the
  // check when the target plan actually caps seats. Without this, a
  // school could downgrade to a smaller plan while already over that
  // plan's limit, silently leaving them over-quota with no signal until
  // something else (a future seat-limit check at student-creation time,
  // if you add one) started rejecting new students for a reason that
  // traces back to a plan change made weeks earlier.
  if (plan.max_students != null) {
    const activeStudents = await studentModel.countActive(req.user.school_id);
    if (activeStudents > plan.max_students) {
      throw new ApiError(
        400,
        `This plan allows up to ${plan.max_students} students, but this school currently has ${activeStudents} enrolled. Withdraw students or choose a larger plan first.`
      );
    }
  }

  const updated = await subscriptionModel.changePlan(live.id, req.user.school_id, planId, req.user.id);
  return sendSuccess(res, 200, updated, 'Plan changed');
});

// -- super_admin: cross-tenant billing operations --

const listAllSubscriptions = asyncHandler(async (req, res) => {
  const { status, limit, offset } = req.query;
  const subscriptions = await subscriptionModel.listAll({
    status, limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, subscriptions);
});

/**
 * Marks a subscription active — the super_admin equivalent of "payment
 * confirmed, unlock the account." Platform billing (schools paying
 * Anthropic^H^H^H^H this SaaS) is deliberately NOT wired to M-Pesa here —
 * that's the fees module, which is schools collecting from parents, a
 * completely different money flow. Confirming a school's own subscription
 * payment (bank transfer, invoice, manual M-Pesa till) is assumed to
 * happen outside this API for now and get recorded here after the fact.
 */
const activateSubscription = asyncHandler(async (req, res) => {
  const target = await subscriptionModel.getById(req.params.id);
  if (!target) throw new ApiError(404, 'Subscription not found');

  const activated = await subscriptionModel.activate(req.params.id, target.school_id, req.user.id);
  return sendSuccess(res, 200, activated, 'Subscription activated');
});

const expireTrials = asyncHandler(async (req, res) => {
  const expired = await subscriptionModel.expireOldTrials();
  return sendSuccess(res, 200, expired, `${expired.length} trial(s) marked past_due`);
});

module.exports = {
  createPlan, listPlans, updatePlan, setPlanActive,
  startTrial, getMySubscription, cancelMySubscription, changeMyPlan,
  listAllSubscriptions, activateSubscription, expireTrials,
};