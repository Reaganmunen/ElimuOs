/**
 * Minimum bar enforced server-side regardless of what a client does —
 * client-side validation can always be bypassed by calling the API
 * directly, so this is the actual line of defense.
 */
function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain at least one letter and one number';
  }
  return null; // valid
}

module.exports = { validatePasswordStrength };