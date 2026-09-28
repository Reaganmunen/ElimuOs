/** Normalises a Kenyan mobile number to 2547XXXXXXXX / 2541XXXXXXXX, or returns null. */
function normalizeKenyanPhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  let n = d;
  if (/^0[17]\d{8}$/.test(d)) n = `254${d.slice(1)}`;
  else if (/^[17]\d{8}$/.test(d)) n = `254${d}`;
  return /^254[17]\d{8}$/.test(n) ? n : null;
}
module.exports = { normalizeKenyanPhone };