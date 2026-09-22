/**
 * Subscription plan reference data for seeding.
 *
 * Mirrors the pricing shown on the landing page (index.html #pricing).
 * Only Starter and Growth are here — Multi-campus is "Custom" pricing
 * with a "Talk to us" CTA, not a self-serve trial plan, so it has no
 * row here. It should be handled as a contact-sales flow, not a
 * billing_plans / start-trial option (monthly_price_kes is NOT NULL,
 * so there's no honest "custom" value to put in this table).
 *
 * features is a jsonb array here (not an object) so the exact wording
 * from the landing page carries straight through to choose-plan.html's
 * renderFeatureList, which prints array items verbatim.
 */

const subscriptionPlans = [
  {
    name: 'Starter',
    maxStudents: 150,
    monthlyPriceKes: 3500,
    features: [
      'Academics & attendance',
      'Fee structures & invoicing',
      'M-Pesa payment reconciliation',
      'Parent portal',
    ],
  },
  {
    name: 'Growth',
    maxStudents: 600,
    monthlyPriceKes: 8500,
    features: [
      'Academics & attendance',
      'Fee structures & invoicing',
      'M-Pesa payment reconciliation',
      'Parent portal',
      'Staff profiles & teaching assignments',
      'Communication & notifications',
      'Full audit log',
    ],
  },
];

module.exports = { subscriptionPlans };