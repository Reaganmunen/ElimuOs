const { query } = require('../config/db');

async function create({ name, maxStudents, monthlyPriceKes, features }) {
  const result = await query(
    `INSERT INTO subscription_plans (name, max_students, monthly_price_kes, features)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, maxStudents || null, monthlyPriceKes, JSON.stringify(features || {})]
  );
  return result.rows[0];
}

async function list({ includeInactive = false } = {}) {
  const filter = includeInactive ? '' : 'WHERE is_active = true';
  const result = await query(`SELECT * FROM subscription_plans ${filter} ORDER BY monthly_price_kes`);
  return result.rows;
}

async function getById(id) {
  const result = await query(`SELECT * FROM subscription_plans WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function update(id, fields) {
  const allowed = ['name', 'max_students', 'monthly_price_kes', 'features'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return getById(id);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => (k === 'features' ? JSON.stringify(fields[k]) : fields[k]));

  const result = await query(
    `UPDATE subscription_plans SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return result.rows[0] || null;
}

// Plans are never hard-deleted — school_subscriptions rows reference them
// historically, and deleting a plan out from under an old subscription
// would break that record's ability to show what the school was paying
// for at the time. Retiring just hides it from new sign-ups.
async function setActive(id, isActive) {
  const result = await query(
    `UPDATE subscription_plans SET is_active = $1 WHERE id = $2 RETURNING *`,
    [isActive, id]
  );
  return result.rows[0] || null;
}

module.exports = { create, list, getById, update, setActive };