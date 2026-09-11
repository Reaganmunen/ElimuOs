const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

/**
 * Upserts a staff profile for a user. One-to-one with users (enforced by
 * the UNIQUE constraint on staff_profiles.user_id) — this is deliberately
 * upsert-by-user_id rather than a plain insert, since "edit the teacher's
 * TSC number" and "set it for the first time" are the same operation from
 * the caller's point of view.
 */
async function upsert(schoolId, userId, { tscNumber, employmentDate, designation }, actorUserId) {
  return withTenantClient(schoolId, async (client) => {
    // Confirm the user actually belongs to this school before attaching a
    // profile to them — user_id alone isn't enough to prove tenant ownership.
    const userCheck = await client.query(`SELECT id FROM users WHERE id = $1 AND school_id = $2`, [userId, schoolId]);
    if (userCheck.rows.length === 0) {
      throw new Error('User not found in this school');
    }

    const result = await client.query(
      `INSERT INTO staff_profiles (user_id, school_id, tsc_number, employment_date, designation)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id)
       DO UPDATE SET tsc_number = EXCLUDED.tsc_number,
                     employment_date = EXCLUDED.employment_date,
                     designation = EXCLUDED.designation
       RETURNING *`,
      [userId, schoolId, tscNumber, employmentDate, designation]
    );
    const profile = result.rows[0];

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'upsert', tableName: 'staff_profiles', recordId: profile.id,
      details: { targetUserId: userId, designation },
    });

    return profile;
  });
}

async function getByUserId(schoolId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT sp.*, u.full_name, u.email, u.phone, r.code AS role_code
       FROM staff_profiles sp
       JOIN users u ON u.id = sp.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE sp.user_id = $1 AND sp.school_id = $2`,
      [userId, schoolId]
    );
    return result.rows[0] || null;
  });
}

async function listBySchool(schoolId, { roleCode, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [schoolId, limit, offset];
    let roleFilter = '';
    if (roleCode) {
      params.push(roleCode);
      roleFilter = `AND r.code = $${params.length}`;
    }
    const result = await client.query(
      `SELECT sp.*, u.full_name, u.email, u.phone, r.code AS role_code
       FROM staff_profiles sp
       JOIN users u ON u.id = sp.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE sp.school_id = $1 AND u.deleted_at IS NULL ${roleFilter}
       ORDER BY u.full_name
       LIMIT $2 OFFSET $3`,
      params
    );
    return result.rows;
  });
}

async function remove(schoolId, userId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM staff_profiles WHERE user_id = $1 AND school_id = $2 RETURNING user_id`,
      [userId, schoolId]
    );
    return result.rows[0] || null;
  });
}

module.exports = { upsert, getByUserId, listBySchool, remove };