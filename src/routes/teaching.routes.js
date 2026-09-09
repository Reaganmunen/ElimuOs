const express = require('express');
const {
  createAssignment, listAssignmentsByClass, listMyAssignments, removeAssignment,
  createTimetableSlot, listTimetableByClass, listMyTimetable, removeTimetableSlot,
} = require('../controllers/teaching.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/assignments', restrictTo('school_admin'), createAssignment);
router.get('/assignments/my', restrictTo('teacher'), listMyAssignments);
router.get('/assignments/class/:classId', restrictTo('school_admin', 'teacher'), listAssignmentsByClass);
router.delete('/assignments/:id', restrictTo('school_admin'), removeAssignment);

router.post('/timetable', restrictTo('school_admin'), createTimetableSlot);
router.get('/timetable/my', restrictTo('teacher'), listMyTimetable);
router.get('/timetable/class/:classId', listTimetableByClass);
router.delete('/timetable/:id', restrictTo('school_admin'), removeTimetableSlot);

module.exports = router;
