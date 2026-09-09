const { query, withTenantClient } = require('../config/db');
const { hashPassword } = require('../utils/password.util');

/**
 * Login lookup happens BEFORE we know the tenant (the client doesn't have a
 * JWT yet), so this intentionally uses the plain, non-tenant-scoped `query`.
 * It joins roles so the controller gets role_code directly for the JWT payload.
 * Can return multiple rows if the same email exists at more than one school —
 * the controller decides how to handle that (see auth.controller.js).
 */
async function findByEmailAcrossSchools(email) {
  const result = await query(
    `SELECT u.id, u.school_id, u.full_name, u.email, u.password_hash, u.is_active,
            r.code AS role_code, s.name AS school_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.email = $1 AND u.deleted_at IS NULL`,
    [email]
  );
  return result.rows;
}

async function findByEmailInSchool(email, schoolId) {
  const result = await query(
    `SELECT u.id, u.school_id, u.full_name, u.email, u.password_hash, u.is_active,
            r.code AS role_code
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.school_id = $2 AND u.deleted_at IS NULL`,
    [email, schoolId]
  );
  return result.rows[0] || null;
}

async function findById(id, schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] || null;
  });
}

/**
 * Creates a user within a tenant. roleCode is resolved to role_id via a
 * lookup against the (small, global) roles table.
 */
async function create({ schoolId, fullName, email, phone, password, roleCode }) {
  const passwordHash = await hashPassword(password);

  return withTenantClient(schoolId, async (client) => {
    const roleResult = await client.query(`SELECT id FROM roles WHERE code = $1`, [roleCode]);
    if (roleResult.rows.length === 0) {
      throw new Error(`Unknown role code: ${roleCode}`);
    }
    const roleId = roleResult.rows[0].id;

    const result = await client.query(
      `INSERT INTO users (school_id, role_id, full_name, email, phone, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, uuid, full_name, email, phone, created_at`,
      [schoolId, roleId, fullName, email, phone, passwordHash]
    );
    return result.rows[0];
  });
}

async function listBySchool(schoolId, { roleCode, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [limit, offset];
    let roleFilter = '';
    if (roleCode) {
      params.push(roleCode);
      roleFilter = `AND r.code = $${params.length}`;
    }
    const result = await client.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, r.code AS role_code, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL ${roleFilter}
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows;
  });
}

async function updatePasswordHash(userId, passwordHash) {
  const result = await query(
    `UPDATE users SET password_hash = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, email`,
    [passwordHash, userId]
  );
  return result.rows[0] || null;
}

module.exports = { findByEmailAcrossSchools, findByEmailInSchool, findById, create, listBySchool, updatePasswordHash };