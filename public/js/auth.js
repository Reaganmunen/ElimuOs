/**
 * ElimuOs.auth — login, registration, session bootstrap and logout,
 * shared by every page. Depends on api.js being loaded first.
 */
(function () {
  const { rawFetch, apiFetch, setAccessToken } = window.ElimuOs.api;
  const REFRESH_KEY = 'elimuos_refresh_token';

  function storeRefreshToken(token) {
    localStorage.setItem(REFRESH_KEY, token);
  }
  function getStoredRefreshToken() {
    return localStorage.getItem(REFRESH_KEY);
  }
  function clearSession() {
    localStorage.removeItem(REFRESH_KEY);
    setAccessToken(null);
  }

  /**
   * POST /auth/login. Returns { status, body } rather than throwing on a
   * non-2xx — unlike every other endpoint, a non-2xx here isn't
   * necessarily a failure: 300 means "this email exists at more than one
   * school, pick one and resend with schoolId", which the caller (the
   * login page) needs to branch on, not treat as an error.
   */
  async function login({ email, password, schoolId }) {
    const { res, body } = await rawFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, schoolId }),
    });

    if (res.status === 200 && body?.data?.accessToken) {
      setAccessToken(body.data.accessToken);
      storeRefreshToken(body.data.refreshToken);
    }

    return { status: res.status, body };
  }

  async function registerSchool(payload) {
    const { res, body } = await rawFetch('/auth/register-school', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (res.status === 201 && body?.data?.accessToken) {
      setAccessToken(body.data.accessToken);
      storeRefreshToken(body.data.refreshToken);
    }

    return { status: res.status, body };
  }

  /**
   * Exchanges the stored refresh token for a new access token, rotating
   * the refresh token in storage too (the backend revokes the old one on
   * every refresh — see refreshToken.model.js rotate()). Used both by
   * apiFetch's automatic 401 retry and by bootstrap() below.
   *
   * Returns true on success, false when the refresh token itself is
   * actually invalid/expired/revoked (a real 401 — session is over,
   * caller should log out), or the string 'rate_limited' on a 429 — a
   * transient server-side throttle that says nothing about whether the
   * refresh token is still good. Conflating that with an invalid token
   * used to wipe a perfectly valid session and force a login loop.
   */
  // Guards against the exact race that used to nuke valid sessions: if
  // several apiFetch calls 401 at once (e.g. a page's Promise.all batch
  // firing when the access token is stale), each one used to call
  // silentRefresh() independently. Refresh tokens are rotate-on-use, so
  // only the first of those calls succeeds — the rest race against an
  // already-revoked token, get a genuine 401 from the server, and
  // clearSession() wipes out the brand-new (perfectly valid) refresh
  // token the first call just stored. Every concurrent caller now
  // awaits the SAME in-flight refresh instead of starting its own.
  let inflightRefresh = null;

  async function silentRefresh() {
    if (inflightRefresh) return inflightRefresh;

    inflightRefresh = (async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return false;

      const { res, body } = await rawFetch('/auth/refresh-token', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });

      if (res.status === 429) return 'rate_limited';

      if (!res.ok) {
        clearSession();
        return false;
      }
      setAccessToken(body.data.accessToken);
      storeRefreshToken(body.data.refreshToken);
      return true;
    })();

    try {
      return await inflightRefresh;
    } finally {
      inflightRefresh = null;
    }
  }

  /**
   * Call at the top of every PROTECTED page (dashboards, not login/
   * register/the landing page). Mints a fresh access token from the
   * stored refresh token, then fetches the current user so the page has
   * role/name to work with — refresh-token's own response deliberately
   * carries no user info (see auth.controller.js), only login's does.
   * Redirects to the login page on any failure, so a protected page
   * never renders without a valid session.
   *
   * options.allowRoles: if given, a logged-in user whose role isn't in
   * the list is redirected to their OWN correct dashboard rather than
   * shown someone else's page — e.g. a teacher hitting /admin/... lands
   * safely back on /teacher/dashboard.html instead of at a dead end.
   *
   * options.requireLiveSubscription: gates entry on the SCHOOL's
   * subscription, not the user's role — the intended shape is "the
   * school admin created this staff account; that account should only
   * work while the school's plan is trial/active." Deliberately skipped
   * for school_admin itself: the admin is the one person who must always
   * be able to get in to see billing and fix a lapsed plan, so this
   * option should never be passed with allowRoles including
   * 'school_admin', but it no-ops for that role either way as a second
   * line of defense. Requires billing.js to be loaded before this call
   * (script order: api.js, billing.js, auth.js, then the page's own
   * inline script) — every page using this option must include it.
   */
  async function bootstrap(options = {}) {
    let ok = await silentRefresh();

    // A 429 says nothing about whether the session is valid — don't
    // treat it like one and don't clear the (still-good) refresh token.
    // Back off briefly and retry a couple of times; this should be rare
    // now that refresh has its own generous limiter, and only fires for
    // real if something is refreshing in a tight loop.
    for (let attempt = 0; ok === 'rate_limited' && attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      ok = await silentRefresh();
    }

    if (ok === 'rate_limited') {
      alert("You're refreshing this too quickly — please wait a moment and reload the page.");
      return null;
    }
    if (!ok) {
      redirectToLogin();
      return null;
    }

    let user;
    try {
      const me = await apiFetch('/auth/me');
      user = me.data;
    } catch (err) {
      redirectToLogin();
      return null;
    }

    if (options.allowRoles && !options.allowRoles.includes(user.role_code)) {
      window.location.href = dashboardPathForRole(user.role_code);
      return null;
    }

    if (options.requireLiveSubscription && user.role_code !== 'school_admin') {
      let isLive = false;
      try {
        const status = await window.ElimuOs.billing.getMyStatus();
        isLive = !!status.isLive;
      } catch (err) {
        isLive = false; // can't confirm the school's plan is live — fail closed, not open
      }
      if (!isLive) {
        window.location.href = '/subscription-locked.html';
        return null;
      }
    }

    return user;
  }

  function redirectToLogin() {
    clearSession();
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `/login.html?returnTo=${returnTo}`;
  }

  async function logout() {
    const refreshToken = getStoredRefreshToken();
    try {
      await rawFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
    } catch (err) {
      // Logging out client-side still succeeds even if the network call
      // fails — the stored token is cleared either way below.
    }
    clearSession();
    window.location.href = '/index.html';
  }

  /**
   * Where each role's dashboard lives. super_admin has no web dashboard
   * yet (platform-level accounts are created via the createSuperAdmin
   * CLI script, not through this UI) — callers should check for that
   * case before redirecting rather than send a super_admin into a page
   * that doesn't exist.
   */
  function dashboardPathForRole(roleCode) {
    switch (roleCode) {
      case 'school_admin': return '/admin/dashboard.html';
      case 'accountant': return '/accountant/dashboard.html';
      case 'teacher': return '/teacher/dashboard.html';
      case 'parent': return '/parent/dashboard.html';
      case 'student': return '/student/dashboard.html';
      default: return null;
    }
  }

  window.ElimuOs.auth = {
    login, registerSchool, silentRefresh, bootstrap, logout,
    dashboardPathForRole, clearSession, getStoredRefreshToken,
  };
})();