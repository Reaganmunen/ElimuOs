/**
 * ElimuOs.billing — plan browsing + a school's own subscription lifecycle.
 * Depends on api.js (ElimuOs.api.apiFetch) being loaded first.
 *
 * Server contract this wraps (see billing.routes.js / billing.controller.js):
 *   GET   /billing/plans                         any authenticated role
 *   POST  /billing/subscriptions/start-trial      school_admin
 *   GET   /billing/subscriptions/mine             school_admin, accountant
 *   POST  /billing/subscriptions/mine/cancel      school_admin
 *   PATCH /billing/subscriptions/mine/plan        school_admin
 *
 * A few backend behaviors this module deliberately works around rather
 * than hides, because pages need to react to them:
 *   - GET /subscriptions/mine 404s when the school has never started a
 *     trial, or when its only subscription is 'cancelled' (the server
 *     returns the most recent row regardless of status, but a cancelled
 *     one isn't "live" — see hasLiveStatus below). getMine() below
 *     normalizes that 404 to `null` instead of throwing, so callers can
 *     just check `if (!sub)` instead of try/catching a 404 everywhere.
 *   - There is no endpoint that returns a school's active-student COUNT
 *     on its own (billing.controller's own over-quota check runs
 *     server-side, inside changePlan, using a model function that isn't
 *     exposed over HTTP). estimateStudentUsage() below approximates it
 *     from GET /students with a high limit and counts the rows returned
 *     — good enough for a usage bar, but it will silently under-count
 *     past whatever limit is passed. A dedicated
 *     GET /students/count?status=active endpoint would remove the need
 *     for this and is worth adding backend-side later.
 */
(function () {
  const { apiFetch } = window.ElimuOs.api;

  const LIVE_STATUSES = ['trial', 'active', 'past_due'];

  function hasLiveStatus(subscription) {
    return !!subscription && LIVE_STATUSES.includes(subscription.status);
  }

  async function listPlans({ includeInactive = false } = {}) {
    const qs = includeInactive ? '?includeInactive=true' : '';
    const res = await apiFetch(`/billing/plans${qs}`);
    return res.data;
  }

  /**
   * Returns the school's most recent subscription row, or `null` if it
   * has none yet (never started a trial). Does NOT filter by status —
   * callers that only care about a *live* subscription should check
   * `hasLiveStatus(sub)` themselves, since a cancelled subscription is
   * still a real row this returns, just not one that grants access.
   */
  async function getMine() {
    try {
      const res = await apiFetch('/billing/subscriptions/mine');
      return res.data;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * GET /billing/subscriptions/mine/status — the only billing endpoint
   * every role (not just school_admin/accountant) is allowed to call.
   * Returns { status, isLive } and never throws on "no subscription" —
   * that's just `{ status: 'none', isLive: false }`, not a 404, since
   * this is a status check, not a subscription fetch. Used by
   * auth.js's bootstrap({ requireLiveSubscription: true }) to decide
   * whether a non-admin role is let into their own dashboard.
   */
  async function getMyStatus() {
    const res = await apiFetch('/billing/subscriptions/mine/status');
    return res.data;
  }

  async function startTrial(planId) {
    const res = await apiFetch('/billing/subscriptions/start-trial', {
      method: 'POST',
      body: JSON.stringify({ planId }),
    });
    return res.data;
  }

  async function changePlan(planId) {
    const res = await apiFetch('/billing/subscriptions/mine/plan', {
      method: 'PATCH',
      body: JSON.stringify({ planId }),
    });
    return res.data;
  }

  async function cancel() {
    const res = await apiFetch('/billing/subscriptions/mine/cancel', { method: 'POST' });
    return res.data;
  }

  /**
   * Best-effort active-student count — see the file header note on why
   * this isn't exact. `cap` should be comfortably above any realistic
   * school size; if the count returned equals `cap`, treat the number as
   * a floor ("at least this many") rather than an exact total.
   */
  async function estimateStudentUsage(cap = 5000) {
    const res = await apiFetch(`/students?status=active&limit=${cap}&offset=0`);
    const count = Array.isArray(res.data) ? res.data.length : 0;
    return { count, isFloor: count === cap };
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const diffMs = new Date(dateString).getTime() - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  function formatKes(amount) {
    if (amount == null) return '—';
    return `KES ${Number(amount).toLocaleString('en-KE')}`;
  }

  /**
   * Renders the small status chip used in the admin topbar. `sub` is
   * whatever getMine() returned (possibly null). Returns an object with
   * the chip's HTML and a `tone` the caller can ignore or use elsewhere —
   * kept as a pure function (no DOM writes) so both dashboard.html and
   * billing.html can reuse it without one owning the other's markup.
   */
  function statusChip(sub) {
    if (!sub || sub.status === 'cancelled') {
      return { tone: 'warn', html: '<i class="bi bi-exclamation-triangle-fill"></i> No active plan' };
    }
    if (sub.status === 'trial') {
      const left = daysUntil(sub.trial_ends_at);
      const label = left == null ? 'Trial' : left <= 0 ? 'Trial ended' : `Trial — ${left}d left`;
      return { tone: left != null && left <= 3 ? 'warn' : 'info', html: `<i class="bi bi-hourglass-split"></i> ${label}` };
    }
    if (sub.status === 'past_due') {
      return { tone: 'error', html: '<i class="bi bi-exclamation-circle-fill"></i> Payment past due' };
    }
    if (sub.status === 'active') {
      return { tone: 'ok', html: `<i class="bi bi-check-circle-fill"></i> ${sub.plan_name || 'Active'}` };
    }
    return { tone: 'info', html: sub.status };
  }

  /**
   * Whether the school's subscription state should block NEW seat-creating
   * actions on this page (add staff, add class, etc.) — as opposed to
   * statusChip/gateAlert, which just describe the state. Not enforced by
   * the backend yet (requireLiveSubscription middleware is unwired — see
   * subscription.middleware.js), so this is a client-side courtesy: no
   * sense letting an admin create a teacher login that can't sign in once
   * that middleware does get wired, or that already can't today if
   * requireLiveSubscription({allowRoles: staff roles}) is added to those
   * dashboards. 'trial' and 'active' are fine; no subscription at all,
   * 'cancelled', and 'past_due' are not.
   */
  function blocksNewSeats(sub) {
    return !sub || sub.status === 'cancelled' || sub.status === 'past_due';
  }

  /**
   * Shared "your plan needs attention" banner — same three cases
   * dashboard.html renders inline, factored out so any admin page can
   * show the identical banner above an "Add X" action. Returns null when
   * there's nothing worth surfacing. Pure function (no DOM writes); caller
   * drops `.html` into an alert-elimu wrapper with the given `.tone`.
   */
  function gateAlert(sub) {
    if (!sub || sub.status === 'cancelled') {
      return {
        tone: 'warn', icon: 'bi-exclamation-triangle-fill',
        html: `This school doesn't have an active plan yet. <a href="billing.html" style="color:#8A5B14; font-weight:700; text-decoration:underline;">Start a trial</a> to add staff or classes.`,
      };
    }
    if (sub.status === 'past_due') {
      return {
        tone: 'error', icon: 'bi-exclamation-circle-fill',
        html: `Your subscription payment is past due — staff can't sign in until this is resolved. <a href="billing.html" style="color:#B23350; font-weight:700; text-decoration:underline;">Sort out billing</a>.`,
      };
    }
    if (sub.status === 'trial') {
      const left = daysUntil(sub.trial_ends_at);
      if (left != null && left <= 3) {
        return {
          tone: 'warn', icon: 'bi-hourglass-split',
          html: `Your trial ends in ${Math.max(left, 0)} day${left === 1 ? '' : 's'}. <a href="billing.html" style="color:#8A5B14; font-weight:700; text-decoration:underline;">Review plans</a> before it does.`,
        };
      }
    }
    return null;
  }

  window.ElimuOs = window.ElimuOs || {};
  window.ElimuOs.billing = {
    LIVE_STATUSES, hasLiveStatus,
    listPlans, getMine, getMyStatus, startTrial, changePlan, cancel, estimateStudentUsage,
    daysUntil, formatKes, statusChip, blocksNewSeats, gateAlert,
  };
})();