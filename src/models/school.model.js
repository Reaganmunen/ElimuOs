const { query } = require('../config/db');

async function create({ name, knec_code, county, sub_county, address, phone, email }) {
  const result = await query(
    `INSERT INTO schools (name, knec_code, county, sub_county, address, phone, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, uuid, name, county, sub_county, phone, email, created_at`,
    [name, knec_code, county, sub_county, address, phone, email]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await query(
    `SELECT * FROM schools WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByName(name) {
  // Used at login time to resolve a school by name/slug when a user's
  // email is ambiguous across tenants.
  const result = await query(
    `SELECT id, name FROM schools WHERE name ILIKE $1 AND deleted_at IS NULL`,
    [`%${name}%`]
  );
  return result.rows;
}

async function list({ limit = 50, offset = 0 } = {}) {
  const result = await query(
    `SELECT id, uuid, name, county, is_active, created_at
     FROM schools
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function update(id, fields) {
  const allowed = ['name', 'county', 'sub_county', 'address', 'phone', 'email', 'logo_url', 'is_active'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(id);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const result = await query(
    `UPDATE schools SET ${setClause} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...values]
  );
  return result.rows[0] || null;
}

module.exports = { create, findById, findByName, list, update };
