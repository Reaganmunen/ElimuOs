// ElimuOs — landing page behavior
// Kept deliberately light: this page is static marketing content.
// Real data (login, dashboards, portal) will call the Express API via fetch()
// once those pages are built, e.g.:
//
//   const res = await fetch('/api/auth/login', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ email, password })
//   });

document.addEventListener('DOMContentLoaded', () => {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});