const { withTenantClient } = require('../config/db');

const DEFAULTS = {
  workingDays: [1, 2, 3, 4, 5],
  periodsPerDay: 8,
  periodDurationMinutes: 40,
  dayStartTime: '08:00',
  breaks: [],
};

function mapRow(row) {
  if (!row) return null;
  return {
    schoolId: row.school_id,
    workingDays: row.working_days,
    periodsPerDay: row.periods_per_day,
    periodDurationMinutes: row.period_duration_minutes,
    dayStartTime: row.day_start_time,
    breaks: row.breaks,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns this school's timetable config, or the module-level DEFAULTS if
 * the school hasn't set one yet — callers (the generator, in particular)
 * should never have to special-case "no config exists".
 */
async function get(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM timetable_configs WHERE school_id = $1`, [schoolId]);
    return mapRow(result.rows[0]) || { schoolId, ...DEFAULTS };
  });
}

async function upsert(schoolId, { workingDays, periodsPerDay, periodDurationMinutes, dayStartTime, breaks }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO timetable_configs (school_id, working_days, periods_per_day, period_duration_minutes, day_start_time, breaks, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (school_id)
       DO UPDATE SET working_days = EXCLUDED.working_days,
                     periods_per_day = EXCLUDED.periods_per_day,
                     period_duration_minutes = EXCLUDED.period_duration_minutes,
                     day_start_time = EXCLUDED.day_start_time,
                     breaks = EXCLUDED.breaks,
                     updated_at = now()
       RETURNING *`,
      [
        schoolId,
        workingDays || DEFAULTS.workingDays,
        periodsPerDay || DEFAULTS.periodsPerDay,
        periodDurationMinutes || DEFAULTS.periodDurationMinutes,
        dayStartTime || DEFAULTS.dayStartTime,
        JSON.stringify(breaks || DEFAULTS.breaks),
      ]
    );
    return mapRow(result.rows[0]);
  });
}

module.exports = { get, upsert, DEFAULTS };
