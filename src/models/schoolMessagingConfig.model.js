const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');

async function get(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM school_messaging_configs WHERE school_id = $1`, [schoolId]);
    return result.rows[0] || null;
  });
}

const COLUMNS = [
  'sms_mode', 'sms_sender_id', 'at_username', 'at_api_key_enc',
  'email_mode', 'from_name', 'reply_to', 'smtp_host', 'smtp_port', 'smtp_secure',
  'smtp_user', 'smtp_password_enc', 'smtp_from_email',
];

/**
 * Writes the FULL config row (the controller merges partial updates against
 * the existing row first). The audit entry records which modes were chosen
 * and whether each secret was changed — never the secret values themselves.
 */
async function upsert(schoolId, cfg, actorUserId, { atKeyChanged, smtpPasswordChanged }) {
  return withTenantClient(schoolId, async (client) => {
    const values = COLUMNS.map((c) => cfg[c] ?? null);
    const placeholders = COLUMNS.map((_, i) => `$${i + 3}`);
    const result = await client.query(
      `INSERT INTO school_messaging_configs (school_id, updated_by, ${COLUMNS.join(', ')}, updated_at)
       VALUES ($1, $2, ${placeholders.join(', ')}, now())
       ON CONFLICT (school_id) DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = now(),
         ${COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
       RETURNING *`,
      [schoolId, actorUserId || null, ...values]
    );
    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'update', tableName: 'school_messaging_configs', recordId: schoolId,
      details: { smsMode: cfg.sms_mode, emailMode: cfg.email_mode, atKeyChanged: !!atKeyChanged, smtpPasswordChanged: !!smtpPasswordChanged },
    });
    return result.rows[0];
  });
}

module.exports = { get, upsert };