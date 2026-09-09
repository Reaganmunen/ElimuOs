const { withTenantClient } = require('../config/db');

/**
 * Bulk-marks attendance for a whole class on one date in a single
 * transaction — this is how a teacher actually uses it (mark all 40
 * students at once), not one row at a time.
 * `records` = [{ studentId, status, remark }]
 */
async function markClassAttendance(schoolId, { classId, date, recordedBy, records }) {
  return withTenantClient(schoolId, async (client) => {
    const results = [];
    for (const r of records) {
      const result = await client.query(
        `INSERT INTO attendance_records (school_id, student_id, class_id, date, status, remark, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (student_id, date)
         DO UPDATE SET status = EXCLUDED.status, remark = EXCLUDED.remark, recorded_by = EXCLUDED.recorded_by
         RETURNING *`,
        [schoolId, r.studentId, classId, date, r.status, r.remark || null, recordedBy]
      );
      results.push(result.rows[0]);
    }
    return results;
  });
}

async function getByClassAndDate(schoolId, classId, date) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT ar.*, s.full_name AS student_name, s.admission_number
       FROM attendance_records ar
       JOIN students s ON s.id = ar.student_id
       WHERE ar.class_id = $1 AND ar.date = $2
       ORDER BY s.full_name`,
      [classId, date]
    );
    return result.rows;
  });
}

async function getByStudentRange(schoolId, studentId, startDate, endDate) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT * FROM attendance_records
       WHERE student_id = $1 AND date BETWEEN $2 AND $3
       ORDER BY date`,
      [studentId, startDate, endDate]
    );
    return result.rows;
  });
}

/**
 * Attendance summary (days present / absent / late / excused, and a
 * present-rate percentage) for one student over a date range — the figure
 * that actually goes on a report card.
 */
async function getStudentSummary(schoolId, studentId, startDate, endDate) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `SELECT status, COUNT(*) AS count
       FROM attendance_records
       WHERE student_id = $1 AND date BETWEEN $2 AND $3
       GROUP BY status`,
      [studentId, startDate, endDate]
    );
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    result.rows.forEach((row) => { counts[row.status] = Number(row.count); });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const presentRate = total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : null;
    return { ...counts, total, presentRatePercent: presentRate };
  });
}

module.exports = { markClassAttendance, getByClassAndDate, getByStudentRange, getStudentSummary };
