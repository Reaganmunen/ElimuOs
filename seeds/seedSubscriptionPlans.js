require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { subscriptionPlans } = require('./subscriptionPlansData');

// Find-or-create by name, same idempotent pattern as seedCurriculum.js —
// safe to re-run. Note: this only INSERTs new plans; it deliberately does
// NOT update price/features on a plan that already exists, since changing
// those under schools with a live subscription is a billing decision, not
// something a seed script should silently do. Update existing plans via a
// migration or the admin billing tooling instead.

async function findOrCreatePlan({ name, maxStudents, monthlyPriceKes, features }) {
  const existing = await query(`SELECT id FROM subscription_plans WHERE name = $1`, [name]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };

  const inserted = await query(
    `INSERT INTO subscription_plans (name, max_students, monthly_price_kes, features)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [name, maxStudents, monthlyPriceKes, JSON.stringify(features)]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function seed() {
  const stats = { plans: 0 };

  console.log('Seeding subscription plans...');
  for (const plan of subscriptionPlans) {
    const result = await findOrCreatePlan({
      name: plan.name,
      maxStudents: plan.maxStudents,
      monthlyPriceKes: plan.monthlyPriceKes,
      features: plan.features,
    });
    if (result.created) {
      stats.plans += 1;
      console.log(`  + created "${plan.name}"`);
    } else {
      console.log(`  = "${plan.name}" already exists, skipped`);
    }
  }

  console.log('\nDone. Newly created this run:');
  console.table(stats);
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    pool.end().finally(() => process.exit(1));
  });