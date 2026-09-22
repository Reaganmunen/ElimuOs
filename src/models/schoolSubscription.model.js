const { query, withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

const DEFAULT_TRIAL_DAYS = 14;
const BILLING_PERIOD_DAYS = 30;

/**
 * Starts a trial subscription for a school. Relies on the partial unique
 * index (idx_one_live_subscription_per_school) as the actual source of
 * truth for "this school already has a live subscription" — we still
 * check first for a clean error message, but the DB constraint is what
 * actually prevents a race condition (two concurrent requests both passing
 * the pre-check before either commits).
 *
 * Runs through withTenantClient like every other tenant-owned table in
 * this codebase (school_subscriptions now has RLS enabled — see migration
 * 007 — so this also gets the same defense-in-depth every other model
 * already relies on, not just the WHERE school_id = $x below).
 */
async function startTrial(schoolId, planId, trialDays = DEFAULT_TRIAL_DAYS) {
  return withTenantClient(schoolId, async (client) => {
    const existingResult = await client.query(
      `SELECT * FROM school_subscriptions WHERE school_id = $1 AND status IN ('trial','active','past_due')`,
      [schoolId]
    );
    const existing = existingResult.rows[0];
    if (existing) {
      throw new Error(`School already has a ${existing.status} subscription (id ${existing.id})`);
    }

    try {
      const result = await client.query(
        `INSERT INTO school_subscriptions (school_id, plan_id, status, trial_ends_at)
         VALUES ($1, $2, 'trial', now() + interval '${trialDays} days')
         RETURNING *`,
        [schoolId, planId]
      );
      const subscription = result.rows[0];

      await recordAudit(client, {
        schoolId, userId: null, action: 'start_trial', tableName: 'school_subscriptions', recordId: subscription.id,
        details: { planId },
      });

      return subscription;
    } catch (err) {
      if (err.code === '23505') { // unique_violation — the race condition the pre-check missed
        throw new Error('School already has a live subscription');
      }
      throw err;
    }
  });
}

async function getLiveForSchool(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ss.*, sp.name AS plan_name, sp.max_students, sp.monthly_price_kes
       FROM school_subscriptions ss
       JOIN subscription_plans sp ON sp.id = ss.plan_id
       WHERE ss.school_id = $1 AND ss.status IN ('trial','active','past_due')`,
      [schoolId]
    );
    return result.rows[0] || null;
  });
}

async function getMostRecentForSchool(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ss.*, sp.name AS plan_name, sp.max_students, sp.monthly_price_kes
       FROM school_subscriptions ss
       JOIN subscription_plans sp ON sp.id = ss.plan_id
       WHERE ss.school_id = $1
       ORDER BY ss.created_at DESC
       LIMIT 1`,
      [schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Marks a subscription active (i.e. payment confirmed) and opens a new
 * billing period. Scoped by schoolId as well as id so a school_admin
 * token can never activate a subscription belonging to another tenant —
 * super_admin calls pass schoolId resolved from the subscription row
 * itself (see controller), so this stays a hard boundary either way.
 *
 * Now runs inside withTenantClient, so the audit write is atomic with the
 * update (same guarantee every other model in this codebase has) — it's
 * no longer a separate, unguarded statement.
 */
async function activate(subscriptionId, schoolId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE school_subscriptions
       SET status = 'active', current_period_start = now(), current_period_end = now() + interval '${BILLING_PERIOD_DAYS} days'
       WHERE id = $1 AND school_id = $2
       RETURNING *`,
      [subscriptionId, schoolId]
    );
    const subscription = result.rows[0];
    if (subscription) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'activate', tableName: 'school_subscriptions', recordId: subscriptionId,
        details: { planId: subscription.plan_id },
      });
    }
    return subscription || null;
  });
}

async function cancel(subscriptionId, schoolId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE school_subscriptions SET status = 'cancelled' WHERE id = $1 AND school_id = $2 RETURNING *`,
      [subscriptionId, schoolId]
    );
    if (result.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'cancel', tableName: 'school_subscriptions', recordId: subscriptionId,
        details: {},
      });
    }
    return result.rows[0] || null;
  });
}

async function changePlan(subscriptionId, schoolId, newPlanId, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE school_subscriptions SET plan_id = $3
       WHERE id = $1 AND school_id = $2 AND status IN ('trial','active','past_due')
       RETURNING *`,
      [subscriptionId, schoolId, newPlanId]
    );
    if (result.rows[0]) {
      await recordAudit(client, {
        schoolId, userId: actorUserId, action: 'change_plan', tableName: 'school_subscriptions', recordId: subscriptionId,
        details: { newPlanId },
      });
    }
    return result.rows[0] || null;
  });
}

/**
 * super_admin, cross-tenant — deliberately plain `query()`, not
 * withTenantClient, the same way auditLog.model.js listAll() is. The
 * tenant_isolation_school_subscriptions policy (migration 007) is
 * permissive when app.current_school_id is unset, exactly like
 * audit_logs/mpesa_transactions/users, so this legitimately sees every
 * school's rows.
 */
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
 * Cross-tenant by nature — plain `query()`, same reasoning as listAll above.
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

/**
 * Cross-tenant lookup by id alone — deliberately not scoped, used by
 * super_admin's activateSubscription to resolve which school a
 * subscription id belongs to BEFORE re-scoping every subsequent write to
 * that school_id. Never expose this result directly to a non-super_admin
 * caller without an explicit tenant check.
 */
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
