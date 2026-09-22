/**
 * One-off / operator-only script to create a super_admin account.
 * There is deliberately no HTTP route for this — a super_admin has
 * cross-tenant access to every school on the platform, so the only way
 * to create one is by running this directly against the database from a
 * trusted machine (your own shell, or a CI/deploy step you control).
 *
 * Usage:
 *   node scripts/createSuperAdmin.js --name "Jane Doe" --email jane@yourcompany.com --password "Str0ngPass!"
 *
 * Or, non-interactively via env vars (handy for a one-time deploy step):
 *   SUPER_ADMIN_NAME="Jane Doe" SUPER_ADMIN_EMAIL=jane@yourcompany.com SUPER_ADMIN_PASSWORD="Str0ngPass!" node scripts/createSuperAdmin.js
 */
require('dotenv').config();
const { validatePasswordStrength } = require('../utils/passwordValidator.util');
const userModel = require('../models/user.model');
const { pool } = require('../config/db');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return {
    fullName: args.name || process.env.SUPER_ADMIN_NAME,
    email: args.email || process.env.SUPER_ADMIN_EMAIL,
    password: args.password || process.env.SUPER_ADMIN_PASSWORD,
  };
}

async function main() {
  const { fullName, email, password } = parseArgs();

  if (!fullName || !email || !password) {
    console.error('Usage: node scripts/createSuperAdmin.js --name "Full Name" --email you@example.com --password "..."');
    process.exitCode = 1;
    return;
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    console.error(`Password rejected: ${passwordError}`);
    process.exitCode = 1;
    return;
  }

  try {
    const user = await userModel.createSuperAdmin({ fullName, email, password });
    console.log(`super_admin created: id=${user.id} email=${user.email}`);
  } catch (err) {
    console.error(`Failed to create super_admin: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
