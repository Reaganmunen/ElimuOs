const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const userModel = require('../models/user.model');
const classModel = require('../models/class.model');
const teachingAssignmentModel = require('../models/teachingAssignment.model');
const { validatePasswordStrength } = require('../utils/passwordValidator.util');

// A school_admin creates accounts for their own school only. Only these
// role codes are creatable here — super_admin is platform-level and never
// created this way, and parent/student accounts go through their own
// flows (they're tied to guardians/students rows, not created bare).
const ALLOWED_STAFF_ROLES = ['school_admin', 'teacher', 'accountant'];

const createUser = asyncHandler(async (req, res) => {
  const { fullName, email, phone, password, roleCode } = req.body;
  if (!fullName || !email || !password || !roleCode) {
    throw new ApiError(400, 'fullName, email, password and roleCode are required');
  }
  if (!ALLOWED_STAFF_ROLES.includes(roleCode)) {
    throw new ApiError(400, 'Invalid role for a staff account');
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new ApiError(400, passwordError);

  try {
    // e.g. duplicate email is a normal, expected outcome here — surfaced
    // as a clean 400 rather than a raw DB constraint error.
    const user = await userModel.create({ schoolId: req.user.school_id, fullName, email, phone, password, roleCode }, req.user.id);
    return sendSuccess(res, 201, user, 'User created');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

const listUsers = asyncHandler(async (req, res) => {
  const { roleCode, limit, offset } = req.query;
  const users = await userModel.listBySchool(req.user.school_id, {
    roleCode,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, users);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.params.id, req.user.school_id);
  if (!user) throw new ApiError(404, 'User not found');
  return sendSuccess(res, 200, user);
});

/**
 * "Where should the frontend send this person right after login" — one
 * cheap call the frontend makes right after auth to decide what to
 * render, rather than baking a redirect URL into the login response
 * itself. Deliberately returns data, not a decision: the frontend still
 * decides what a teacher with 3 assignments vs 1 should see.
 *
 * - school_admin / accountant: no class-scoping needed, so classTeacherOf
 *   and teachingAssignments are omitted entirely rather than sent empty —
 *   an omitted field reads as "not applicable to this role", an empty
 *   array reads as "applicable, but there's nothing here", and for these
 *   two roles it's the former.
 * - teacher: classTeacherOf (the one class, if any, where they're the
 *   form/class teacher — classes.class_teacher_id) and
 *   teachingAssignments (every class/subject combination they teach —
 *   teaching_assignments) so the frontend can either drop them straight
 *   into their one class or offer a picker.
 * - parent / student: no school-side class data applies to these roles
 *   at all (their own landing data lives behind the parent-portal /
 *   student-portal routes instead) — same omission reasoning as above.
 */
const getMyLanding = asyncHandler(async (req, res) => {
  const { role, school_id: schoolId, id: userId } = req.user;

  const landing = { role };

  if (role === 'teacher') {
    const [classTeacherOf, teachingAssignments] = await Promise.all([
      classModel.listByClassTeacher(schoolId, userId),
      teachingAssignmentModel.listByTeacher(schoolId, userId),
    ]);
    landing.classTeacherOf = classTeacherOf[0] || null;
    landing.teachingAssignments = teachingAssignments;
  }

  return sendSuccess(res, 200, landing);
});

module.exports = { createUser, listUsers, getUser, getMyLanding };