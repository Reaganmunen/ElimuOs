const { withTenantClient } = require('../config/db');
const { recordAudit } = require('../utils/auditLog.util');
const { generateTimetable } = require('../utils/timetableGenerator.util');
const { DEFAULTS: CONFIG_DEFAULTS } = require('./timetableConfig.model');

/**
 * Converts a period index (1-based) + length (1 or 2) into a concrete
 * [start_time, end_time] pair, accounting for any configured breaks that
 * fall before it. Shared by both manual single-slot creation display and
 * the generator's bulk insert, so "what time does period 4 start" is
 * computed exactly one way in the whole codebase.
 */
function periodToTimeRange(config, startPeriod, length) {
  const [startHour, startMinute] = String(config.dayStartTime).split(':').map(Number);
  let minutesFromDayStart = (startPeriod - 1) * config.periodDurationMinutes;

  for (const brk of config.breaks || []) {
    if (brk.after_period < startPeriod) {
      minutesFromDayStart += brk.duration_minutes;
    }
  }

  const toClock = (totalMinutes) => {
    const total = startHour * 60 + startMinute + totalMinutes;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  };

  const startTime = toClock(minutesFromDayStart);
  const endTime = toClock(minutesFromDayStart + length * config.periodDurationMinutes);
  return { startTime, endTime };
}

/**
 * Manual single-slot creation now checks for conflicts before inserting —
 * previously nothing (not the app, not the schema — there's no unique
 * constraint on timetable_slots covering this) stopped two overlapping
 * slots for the same class or the same teacher from both being created.
 */
async function create(schoolId, { teachingAssignmentId, dayOfWeek, startTime, endTime }) {
  return withTenantClient(schoolId, async (client) => {
    const assignmentResult = await client.query(
      `SELECT class_id, teacher_id FROM teaching_assignments WHERE id = $1 AND school_id = $2`,
      [teachingAssignmentId, schoolId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new Error('Teaching assignment not found in this school');

    const conflictResult = await client.query(
      `SELECT ts.id, ts.start_time, ts.end_time,
              (ta.class_id = $3) AS is_class_conflict, (ta.teacher_id = $4) AS is_teacher_conflict
       FROM timetable_slots ts
       JOIN teaching_assignments ta ON ta.id = ts.teaching_assignment_id
       WHERE ts.school_id = $1 AND ts.day_of_week = $2
         AND (ta.class_id = $3 OR ta.teacher_id = $4)
         AND ts.start_time < $6 AND ts.end_time > $5`,
      [schoolId, dayOfWeek, assignment.class_id, assignment.teacher_id, startTime, endTime]
    );
    if (conflictResult.rows.length > 0) {
      const conflict = conflictResult.rows[0];
      const reason = conflict.is_class_conflict && conflict.is_teacher_conflict
        ? 'this class and this teacher already have'
        : conflict.is_class_conflict ? 'this class already has' : 'this teacher already has';
      throw new Error(`Cannot create this slot — ${reason} another slot on this day overlapping ${conflict.start_time}–${conflict.end_time}`);
    }

    const result = await client.query(
      `INSERT INTO timetable_slots (school_id, teaching_assignment_id, day_of_week, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, teachingAssignmentId, dayOfWeek, startTime, endTime]
    );
    return result.rows[0];
  });
}

async function listByClass(schoolId, classId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ts.*, la.name AS learning_area_name, u.full_name AS teacher_name
       FROM timetable_slots ts
       JOIN teaching_assignments ta ON ta.id = ts.teaching_assignment_id
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN users u ON u.id = ta.teacher_id
       WHERE ta.class_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [classId]
    );
    return result.rows;
  });
}

async function listByTeacher(schoolId, teacherId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ts.*, la.name AS learning_area_name, c.stream_name, g.name AS grade_name
       FROM timetable_slots ts
       JOIN teaching_assignments ta ON ta.id = ts.teaching_assignment_id
       JOIN learning_areas la ON la.id = ta.learning_area_id
       JOIN classes c ON c.id = ta.class_id
       JOIN grades g ON g.id = c.grade_id
       WHERE ta.teacher_id = $1
       ORDER BY ts.day_of_week, ts.start_time`,
      [teacherId]
    );
    return result.rows;
  });
}

async function remove(schoolId, slotId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `DELETE FROM timetable_slots WHERE id = $1 AND school_id = $2 RETURNING id`,
      [slotId, schoolId]
    );
    return result.rows[0] || null;
  });
}

/**
 * Generates (and REPLACES) the timetable for every class in the school
 * for one academic year, in a single pass. Deliberately whole-school, not
 * per-class: a teacher who teaches two different classes can only be
 * scheduled correctly if both classes' schedules are built together — the
 * conflict is invisible if you generate one class at a time.
 *
 * "Replaces" means: every existing timetable_slots row belonging to a
 * teaching_assignment in this academic year is deleted first, then the
 * freshly generated set is inserted — all inside one transaction, so a
 * failed generation never leaves the school with half an old timetable
 * and half nothing.
 */
async function generateForSchool(schoolId, academicYearId, { allowDoublePeriods = true, actorUserId } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const configResult = await client.query(`SELECT * FROM timetable_configs WHERE school_id = $1`, [schoolId]);
    const configRow = configResult.rows[0];
    const config = configRow
      ? {
        workingDays: configRow.working_days,
        periodsPerDay: configRow.periods_per_day,
        periodDurationMinutes: configRow.period_duration_minutes,
        dayStartTime: configRow.day_start_time,
        breaks: configRow.breaks,
      }
      : { ...CONFIG_DEFAULTS };

    const assignmentsResult = await client.query(
      `SELECT id, class_id, teacher_id, periods_per_week
       FROM teaching_assignments
       WHERE school_id = $1 AND academic_year_id = $2`,
      [schoolId, academicYearId]
    );
    if (assignmentsResult.rows.length === 0) {
      throw new Error('No teaching assignments exist for this academic year — set those up before generating a timetable');
    }
    const assignments = assignmentsResult.rows.map((r) => ({
      id: r.id, classId: r.class_id, teacherId: r.teacher_id, periodsPerWeek: r.periods_per_week,
    }));

    const breaksAfterPeriods = (config.breaks || []).map((b) => b.after_period);

    const { placements, unplaced } = generateTimetable({
      workingDays: config.workingDays,
      periodsPerDay: config.periodsPerDay,
      breaksAfterPeriods,
      assignments,
      allowDoublePeriods,
    });

    await client.query(
      `DELETE FROM timetable_slots
       WHERE school_id = $1
         AND teaching_assignment_id IN (SELECT id FROM teaching_assignments WHERE school_id = $1 AND academic_year_id = $2)`,
      [schoolId, academicYearId]
    );

    const insertedSlots = [];
    for (const placement of placements) {
      const { startTime, endTime } = periodToTimeRange(config, placement.startPeriod, placement.length);
      const result = await client.query(
        `INSERT INTO timetable_slots (school_id, teaching_assignment_id, day_of_week, start_time, end_time)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [schoolId, placement.teachingAssignmentId, placement.dayOfWeek, startTime, endTime]
      );
      insertedSlots.push(result.rows[0]);
    }

    await recordAudit(client, {
      schoolId, userId: actorUserId, action: 'generate', tableName: 'timetable_slots', recordId: null,
      details: { academicYearId, placed: insertedSlots.length, unplacedCount: unplaced.length },
    });

    return { slots: insertedSlots, unplaced };
  });
}

module.exports = { create, listByClass, listByTeacher, remove, generateForSchool, periodToTimeRange };
