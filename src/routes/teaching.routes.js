const express = require('express');
const {
  createAssignment, listAssignmentsByClass, listMyAssignments, removeAssignment,
  createTimetableSlot, listTimetableByClass, listMyTimetable, removeTimetableSlot,
  getTimetableConfig, updateTimetableConfig, generateTimetable,
} = require('../controllers/teaching.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/assignments', restrictTo('school_admin'), createAssignment);
router.get('/assignments/my', restrictTo('teacher'), listMyAssignments);
router.get('/assignments/class/:classId', restrictTo('school_admin', 'teacher'), listAssignmentsByClass);
router.delete('/assignments/:id', restrictTo('school_admin'), removeAssignment);

router.get('/timetable/config', restrictTo('school_admin'), getTimetableConfig);
router.patch('/timetable/config', restrictTo('school_admin'), updateTimetableConfig);
router.post('/timetable/generate', restrictTo('school_admin'), generateTimetable);

router.post('/timetable', restrictTo('school_admin'), createTimetableSlot);
router.get('/timetable/my', restrictTo('teacher'), listMyTimetable);
// Was missing restrictTo entirely — every other route in this file is
// gated; this one let any authenticated role (including parent/student)
// view a class's timetable, which also indirectly names its teacher.
router.get('/timetable/class/:classId', restrictTo('school_admin', 'teacher'), listTimetableByClass);
router.delete('/timetable/:id', restrictTo('school_admin'), removeTimetableSlot);

module.exports = router;
