/**
 * ElimuOs.api — thin fetch wrapper shared by every page.
 *
 * Access tokens are NEVER written to storage — only kept in this module's
 * in-memory variable, which is why every page that needs one calls
 * ElimuOs.auth.bootstrap() on load to mint a fresh one from the refresh
 * token (see auth.js). That's a deliberate adaptation for a multi-page
 * site: a pure in-memory token can't survive a full page navigation the
 * way it could in a single-page app, so each page re-derives its own.
 */
(function () {
  const API_BASE = window.ELIMU_API_BASE || '/api/v1';
  let accessToken = null;

  function setAccessToken(token) {
    accessToken = token;
  }

  function getAccessToken() {
    return accessToken;
  }

  /**
   * Raw request, no retry-on-401 logic — used by auth.js's own login/
   * refresh calls, which must NOT trigger another refresh attempt on
   * failure (that would recurse). Everything else should use apiFetch.
   */
  async function rawFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
    let body = null;
    try { body = await res.json(); } catch (e) { /* no JSON body, e.g. a PDF download */ }
    return { res, body };
  }

  /**
   * Standard authenticated request. On a 401 (expired access token),
   * refreshes once via the stored refresh token and retries exactly
   * once — never loops. Throws on any other non-2xx response, with the
   * server's own message when there is one.
   */
  async function apiFetch(path, options = {}) {
    let { res, body } = await rawFetch(path, options);

    if (res.status === 401 && accessToken) {
      const refreshed = await window.ElimuOs.auth.silentRefresh();
      if (refreshed === true) {
        ({ res, body } = await rawFetch(path, options));
      }
    }

    if (!res.ok) {
      const message = (body && body.message) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  window.ElimuOs = window.ElimuOs || {};
  window.ElimuOs.api = { API_BASE, rawFetch, apiFetch, setAccessToken, getAccessToken };
})();