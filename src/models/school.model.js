const { query } = require('../config/db');

/**
 * camelCase params, matching every other model in this codebase
 * (student.model.js, guardian.model.js, etc.) — this function previously
 * took raw snake_case params (knec_code, sub_county) which didn't match
 * what auth.controller.js registerSchool() actually passed in
 * ({ name, county, phone, email }), so knecCode/subCounty/address were
 * silently always undefined at registration. A school could never have
 * those fields set at sign-up time; they were only reachable later via
 * updateMySchool.
 */
async function create({ name, knecCode, county, subCounty, address, phone, email }) {
  const result = await query(
    `INSERT INTO schools (name, knec_code, county, sub_county, address, phone, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, uuid, name, knec_code, county, sub_county, address, phone, email, created_at`,
    [name, knecCode || null, county || null, subCounty || null, address || null, phone || null, email || null]
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

// Maps the camelCase field names the rest of the API uses to their
// snake_case DB columns — previously this took raw snake_case keys
// straight off req.body (school.controller.js updateMySchool passes
// req.body through unchanged), the only place in the whole codebase that
// asked API clients to send snake_case instead of camelCase.
const UPDATABLE_FIELDS = {
  name: 'name',
  county: 'county',
  subCounty: 'sub_county',
  address: 'address',
  phone: 'phone',
  email: 'email',
  logoUrl: 'logo_url',
  isActive: 'is_active',
};

async function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE_FIELDS[k] !== undefined);
  if (keys.length === 0) return findById(id);

  const setClause = keys.map((k, i) => `${UPDATABLE_FIELDS[k]} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const result = await query(
    `UPDATE schools SET ${setClause} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...values]
  );
  return result.rows[0] || null;
}

module.exports = { create, findById, findByName, list, update };
