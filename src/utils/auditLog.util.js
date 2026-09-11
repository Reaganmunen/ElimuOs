/**
 * Writes one audit_logs row using the SAME client/transaction as the
 * write it's documenting — deliberately not a separate connection or its
 * own transaction. This means an audit entry and the change it describes
 * live or die together: if the main operation rolls back, so does its
 * audit record, and there's no window where a change exists without a
 * trail (or a trail exists for a change that never actually committed).
 *
 * Call this from INSIDE a withTenantClient(...) callback, passing the same
 * `client` the surrounding function already has. schoolId is passed
 * explicitly rather than read off `client` because the client itself
 * doesn't carry that as JS state — it's just the session variable inside
 * Postgres — so the caller (which already has schoolId as a parameter)
 * supplies it directly.
 *
 * @param client - the pg client from withTenantClient's callback
 * @param schoolId - the tenant this action belongs to
 * @param userId - who performed the action (null for system/automated actions, e.g. an M-Pesa callback)
 * @param action - 'create' | 'update' | 'delete' | 'void' | etc. — free text, keep it short and consistent
 * @param tableName - the DB table the action affected
 * @param recordId - the affected row's id
 * @param details - optional JSON-serializable context (e.g. { amount, method } for a payment)
 */
async function recordAudit(client, { schoolId, userId, action, tableName, recordId, details }) {
  await client.query(
    `INSERT INTO audit_logs (school_id, user_id, action, table_name, record_id, details)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [schoolId, userId || null, action, tableName, recordId || null, JSON.stringify(details || {})]
  );
}

module.exports = { recordAudit };