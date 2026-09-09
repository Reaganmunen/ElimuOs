const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. connection dropped) — log and let the pool recover.
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Plain query — use ONLY for global, non-tenant-scoped tables
 * (curriculum reference data, subscription_plans, roles, or platform-level
 * super_admin operations). Anything touching a school's own data must go
 * through withTenantClient() below so RLS actually applies.
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Runs `callback(client)` inside a transaction with the tenant's school_id
 * set via SET LOCAL, so every query issued through `client` is automatically
 * filtered by the Postgres RLS policies defined in the schema.
 *
 * schoolId MUST come from the verified JWT (req.user.school_id) — never from
 * a request body/query param — or a malicious client could read another
 * school's data by simply passing a different ID.
 *
 * Usage:
 *   const students = await withTenantClient(req.user.school_id, (client) =>
 *     client.query('SELECT * FROM students WHERE current_class_id = $1', [classId])
 *   );
 */
async function withTenantClient(schoolId, callback) {
  if (!schoolId) {
    throw new Error('withTenantClient called without a schoolId — refusing to run an unscoped tenant query');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config with is_local=true mirrors SET LOCAL but is parameterized,
    // avoiding string interpolation of the schoolId into raw SQL.
    await client.query("SELECT set_config('app.current_school_id', $1, true)", [String(schoolId)]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTenantClient };
