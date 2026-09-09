const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const schoolModel = require('../models/school.model');
const userModel = require('../models/user.model');
const { comparePassword, hashPassword } = require('../utils/password.util');
const { signToken } = require('../utils/jwt.util');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');
const { generateResetToken, hashToken } = require('../utils/resetToken.util');
const passwordResetModel = require('../models/passwordReset.model');
const notificationProvider = require('../utils/notification.provider');

/**
 * Onboards a brand-new school (tenant) plus its first admin user in one call.
 * This is the "sign up your school" entry point for the SaaS.
 */
const registerSchool = asyncHandler(async (req, res) => {
  const { schoolName, county, phone, email, adminFullName, adminEmail, adminPassword } = req.body;

  if (!schoolName || !adminEmail || !adminPassword || !adminFullName) {
    throw new ApiError(400, 'schoolName, adminFullName, adminEmail and adminPassword are required');
  }

  const passwordError = validatePasswordStrength(adminPassword);
  if (passwordError) throw new ApiError(400, passwordError);

  const school = await schoolModel.create({ name: schoolName, county, phone, email });

  const admin = await userModel.create({
    schoolId: school.id,
    fullName: adminFullName,
    email: adminEmail,
    password: adminPassword,
    roleCode: 'school_admin',
  });

  const token = signToken({ id: admin.id, school_id: school.id, role_code: 'school_admin' });

  return sendSuccess(res, 201, { school, admin, token }, 'School registered successfully');
});

/**
 * Login by email + password. If the email exists at more than one school
 * (rare, but the schema allows it since uniqueness is per-school), the
 * client must resend the request with a schoolId to disambiguate — we
 * return the matching school names so the frontend can present a picker.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, schoolId } = req.body;
  if (!email || !password) {
    throw new ApiError(400, 'email and password are required');
  }

  const matches = await userModel.findByEmailAcrossSchools(email);
  if (matches.length === 0) {
    throw new ApiError(401, 'Invalid email or password');
  }

  let user;
  if (matches.length === 1) {
    user = matches[0];
  } else if (schoolId) {
    user = matches.find((m) => m.school_id === Number(schoolId));
    if (!user) throw new ApiError(401, 'Invalid email or password');
  } else {
    return sendSuccess(res, 300, {
      requiresSchoolSelection: true,
      schools: matches.map((m) => ({ school_id: m.school_id, school_name: m.school_name })),
    }, 'Multiple schools found for this email — resend with schoolId');
  }

  if (!user.is_active) {
    throw new ApiError(403, 'This account has been deactivated');
  }

  const passwordMatches = await comparePassword(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const token = signToken({ id: user.id, school_id: user.school_id, role_code: user.role_code });

  return sendSuccess(res, 200, {
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role_code,
      school_id: user.school_id,
    },
  }, 'Login successful');
});

const getCurrentUser = asyncHandler(async (req, res) => {
  if (!req.user.school_id) {
    // Platform super_admin accounts aren't attached to a school, so they
    // fall outside the tenant-scoped user lookup entirely.
    throw new ApiError(400, 'Super admin accounts are not tied to a school — use the platform admin endpoint instead');
  }
  const user = await userModel.findById(req.user.id, req.user.school_id);
  if (!user) throw new ApiError(404, 'User not found');
  return sendSuccess(res, 200, user);
});

/**
 * Always responds with the same generic message whether or not the email
 * exists — this is deliberate. Returning a different message for "email
 * not found" vs "reset link sent" lets an attacker enumerate valid emails
 * at your school by trying addresses one at a time. Same reasoning as
 * login's identical "Invalid email or password" for both failure cases.
 *
 * If the email matches more than one school (same rare edge case as
 * login), we can't safely guess which account the person meant, so no
 * email goes out — but the response is still the same generic message.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, 'email is required');

  const genericResponse = () => sendSuccess(res, 200, null, 'If an account with that email exists, a password reset link has been sent.');

  const matches = await userModel.findByEmailAcrossSchools(email);
  if (matches.length !== 1) {
    return genericResponse();
  }
  const user = matches[0];

  const { rawToken, tokenHash } = generateResetToken();
  await passwordResetModel.createToken(user.id, tokenHash);

  const resetLink = `${process.env.CLIENT_ORIGIN || ''}/reset-password?token=${rawToken}`;
  try {
    await notificationProvider.send('email', {
      to: user.email,
      subject: 'Reset your password',
      body: `We received a request to reset your password. This link expires in 30 minutes:\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.`,
    });
  } catch (err) {
    // Don't let an email-provider failure leak into the response — that
    // itself would be a signal distinguishing "found" from "not found".
    // Log it server-side so the failure is still visible operationally.
    console.error('Failed to send password reset email:', err.message);
  }

  return genericResponse();
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) throw new ApiError(400, 'token and newPassword are required');

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) throw new ApiError(400, passwordError);

  const tokenHash = hashToken(token);
  const resetRecord = await passwordResetModel.findValidToken(tokenHash);
  if (!resetRecord) {
    throw new ApiError(400, 'This reset link is invalid or has expired. Please request a new one.');
  }

  const passwordHash = await hashPassword(newPassword);
  await userModel.updatePasswordHash(resetRecord.user_id, passwordHash);
  await passwordResetModel.markUsed(resetRecord.id);
  // Also invalidate any other outstanding tokens for this user, in case
  // multiple reset emails were requested — only the one actually used
  // should ever be usable, and none should survive a completed reset.
  await passwordResetModel.invalidateAllForUser(resetRecord.user_id);

  return sendSuccess(res, 200, null, 'Password has been reset. You can now log in with your new password.');
});

module.exports = { registerSchool, login, getCurrentUser, forgotPassword, resetPassword };