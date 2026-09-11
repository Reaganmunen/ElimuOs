const { withTenantClient, query } = require('../config/db');

async function listBySchool(schoolId, { tableName, userId, action, limit = 50, offset = 0 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const params = [limit, offset];
    let filter = '';
    if (tableName) { params.push(tableName); filter += ` AND al.table_name = $${params.length}`; }
    if (userId) { params.push(userId); filter += ` AND al.user_id = $${params.length}`; }
    if (action) { params.push(action); filter += ` AND al.action = $${params.length}`; }

    const result = await client.query(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE 1=1 ${filter}
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows;
  });
}

async function getForRecord(schoolId, tableName, recordId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.table_name = $1 AND al.record_id = $2
       ORDER BY al.created_at DESC`,
      [tableName, recordId]
    );
    return result.rows;
  });
}

/**
 * Platform-wide, cross-tenant view — super_admin only. Plain query (no
 * tenant context set), relying on audit_logs' permissive-when-unset RLS
 * policy (see migration 006) to legitimately return every school's rows.
 */
async function listAll({ schoolId, tableName, action, limit = 50, offset = 0 } = {}) {
  const params = [limit, offset];
  let filter = '';
  if (schoolId) { params.push(schoolId); filter += ` AND al.school_id = $${params.length}`; }
  if (tableName) { params.push(tableName); filter += ` AND al.table_name = $${params.length}`; }
  if (action) { params.push(action); filter += ` AND al.action = $${params.length}`; }

  const result = await query(
    `SELECT al.*, u.full_name AS actor_name, s.name AS school_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     LEFT JOIN schools s ON s.id = al.school_id
     WHERE 1=1 ${filter}
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return result.rows;
}

module.exports = { listBySchool, getForRecord, listAll };