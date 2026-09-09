const { withTenantClient } = require('../config/db');

async function get(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM school_payment_configs WHERE school_id = $1`,
      [schoolId]
    );
    return result.rows[0] || null;
  });
}

async function upsert(schoolId, { mpesaShortcode, mpesaAccountRefPrefix, secretsManagerKey }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO school_payment_configs (school_id, mpesa_shortcode, mpesa_account_ref_prefix, secrets_manager_key)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (school_id)
       DO UPDATE SET mpesa_shortcode = EXCLUDED.mpesa_shortcode,
                     mpesa_account_ref_prefix = EXCLUDED.mpesa_account_ref_prefix,
                     secrets_manager_key = EXCLUDED.secrets_manager_key
       RETURNING *`,
      [schoolId, mpesaShortcode, mpesaAccountRefPrefix, secretsManagerKey]
    );
    return result.rows[0];
  });
}

module.exports = { get, upsert };
