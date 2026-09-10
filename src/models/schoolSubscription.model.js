const { query } = require('../config/db');

const DEFAULT_TRIAL_DAYS = 14;
const BILLING_PERIOD_DAYS = 30;

/**
 * Starts a trial subscription for a school. Relies on the partial unique
 * index (idx_one_live_subscription_per_school) as the actual source of
 * truth for "this school already has a live subscription" — we still
 * check first for a clean error message, but the DB constraint is what
 * actually prevents a race condition (two concurrent requests both passing
 * the pre-check before either commits).
 */
async function startTrial(schoolId, planId, trialDays = DEFAULT_TRIAL_DAYS) {
  const existing = await getLiveForSchool(schoolId);
  if (existing) {
    throw new Error(`School already has a ${existing.status} subscription (id ${existing.id})`);
  }

  try {
    const result = await query(
      `INSERT INTO school_subscriptions (school_id, plan_id, status, trial_ends_at)
       VALUES ($1, $2, 'trial', now() + interval '${trialDays} days')
       RETURNING *`,
      [schoolId, planId]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') { // unique_violation — the race condition the pre-check missed
      throw new Error('School already has a live subscription');
    }
    throw err;
  }
}

async function getLiveForSchool(schoolId) {
  const result = await query(
    `SELECT ss.*, sp.name AS plan_name, sp.max_students, sp.monthly_price_kes
     FROM school_subscriptions ss
     JOIN subscription_plans sp ON sp.id = ss.plan_id
     WHERE ss.school_id = $1 AND ss.status IN ('trial','active','past_due')`,
    [schoolId]
  );
  return result.rows[0] || null;
}

async function getMostRecentForSchool(schoolId) {
  const result = await query(
    `SELECT ss.*, sp.name AS plan_name, sp.max_students, sp.monthly_price_kes
     FROM school_subscriptions ss
     JOIN subscription_plans sp ON sp.id = ss.plan_id
     WHERE ss.school_id = $1
     ORDER BY ss.created_at DESC
     LIMIT 1`,
    [schoolId]
  );
  return result.rows[0] || null;
}

/**
 * Marks a subscription active (i.e. payment confirmed) and opens a new
 * billing period. Scoped by schoolId as well as id so a school_admin
 * token can never activate a subscription belonging to another tenant —
 * super_admin calls pass schoolId resolved from the subscription row
 * itself (see controller), so this stays a hard boundary either way.
 */
async function activate(subscriptionId, schoolId) {
  const result = await query(
    `UPDATE school_subscriptions
     SET status = 'active', current_period_start = now(), current_period_end = now() + interval '${BILLING_PERIOD_DAYS} days'
     WHERE id = $1 AND school_id = $2
     RETURNING *`,
    [subscriptionId, schoolId]
  );
  return result.rows[0] || null;
}

async function cancel(subscriptionId, schoolId) {
  const result = await query(
    `UPDATE school_subscriptions SET status = 'cancelled' WHERE id = $1 AND school_id = $2 RETURNING *`,
    [subscriptionId, schoolId]
  );
  return result.rows[0] || null;
}

async function changePlan(subscriptionId, schoolId, newPlanId) {
  const result = await query(
    `UPDATE school_subscriptions SET plan_id = $3
     WHERE id = $1 AND school_id = $2 AND status IN ('trial','active','past_due')
     RETURNING *`,
    [subscriptionId, schoolId, newPlanId]
  );
  return result.rows[0] || null;
}

async function listAll({ status, limit = 50, offset = 0 } = {}) {
  const params = [limit, offset];
  let statusFilter = '';
  if (status) {
    params.push(status);
    statusFilter = `AND ss.status = $${params.length}`;
  }
  const result = await query(
    `SELECT ss.*, s.name AS school_name, sp.name AS plan_name
     FROM school_subscriptions ss
     JOIN schools s ON s.id = ss.school_id
     JOIN subscription_plans sp ON sp.id = ss.plan_id
     WHERE 1=1 ${statusFilter}
     ORDER BY ss.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return result.rows;
}

/**
 * Batch job: finds every trial whose trial_ends_at has passed and flips it
 * to past_due (no payment collected yet, but not actively cancelled
 * either — the distinction matters for a dunning email flow later). No
 * cron infrastructure exists yet, so this is exposed as a super_admin
 * endpoint to trigger manually or from an external scheduler (cron, a
 * platform task runner, etc.) rather than running inside this process.
 */
async function expireOldTrials() {
  const result = await query(
    `UPDATE school_subscriptions
     SET status = 'past_due'
     WHERE status = 'trial' AND trial_ends_at < now()
     RETURNING id, school_id, plan_id`
  );
  return result.rows;
}

async function getById(subscriptionId) {
  const result = await query(
    `SELECT ss.*, s.name AS school_name, sp.name AS plan_name
     FROM school_subscriptions ss
     JOIN schools s ON s.id = ss.school_id
     JOIN subscription_plans sp ON sp.id = ss.plan_id
     WHERE ss.id = $1`,
    [subscriptionId]
  );
  return result.rows[0] || null;
}

module.exports = {
  startTrial, getLiveForSchool, getMostRecentForSchool, getById, activate, cancel, changePlan, listAll, expireOldTrials,
};