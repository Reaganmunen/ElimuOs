/**
 * Timetable generation — v1.
 *
 * This is a greedy, constraint-respecting placement algorithm, not a full
 * CSP/backtracking solver. For a typical school's scale (a few dozen
 * teaching assignments per class, a handful of classes) this converges
 * cleanly in practice; it is not guaranteed to find a valid full schedule
 * if one exists (a true solver would backtrack across earlier placements
 * when it gets stuck — this doesn't). When it can't place something, it
 * reports that in `unplaced` instead of silently dropping it or throwing,
 * so a school_admin can see exactly what needs a manual slot or a
 * reduced periods_per_week and fix it by hand via the existing manual
 * POST /teaching/timetable endpoint.
 *
 * Hard constraints (never violated):
 *  - A class is never double-booked in the same day+period.
 *  - A teacher is never double-booked in the same day+period, even
 *    across different classes — this is exactly the constraint that
 *    can't be enforced generating one class at a time, which is why
 *    generation always runs for every class in a school together.
 *  - A double period never starts immediately before a configured break
 *    (it would otherwise need to span the break).
 *
 * Soft constraint (relaxed if it can't be satisfied):
 *  - The same subject is not scheduled twice in one day for the same
 *    class, where avoidable.
 */

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Splits one assignment's weekly period count into placeable chunks.
 * Prefers double periods when allowed: e.g. periodsPerWeek=5 with doubles
 * allowed becomes [2, 2, 1]; periodsPerWeek=4 becomes [2, 2].
 */
function buildUnits(assignment, allowDoublePeriods) {
  const { periodsPerWeek } = assignment;
  if (!allowDoublePeriods) {
    return Array.from({ length: periodsPerWeek }, () => ({ ...assignment, length: 1 }));
  }
  const doubles = Math.floor(periodsPerWeek / 2);
  const singles = periodsPerWeek % 2;
  const units = [];
  for (let i = 0; i < doubles; i += 1) units.push({ ...assignment, length: 2 });
  for (let i = 0; i < singles; i += 1) units.push({ ...assignment, length: 1 });
  return units;
}

/**
 * @param {object} params
 * @param {number[]} params.workingDays - ISO day numbers, 1=Mon..7=Sun
 * @param {number} params.periodsPerDay
 * @param {number[]} params.breaksAfterPeriods - period indices a break
 *   immediately follows; a double period may not start at one of these
 *   (it would need to span the break).
 * @param {Array<{id:number, classId:number, teacherId:number, periodsPerWeek:number}>} params.assignments
 * @param {boolean} params.allowDoublePeriods
 * @returns {{ placements: Array, unplaced: Array }}
 */
function generateTimetable({ workingDays, periodsPerDay, breaksAfterPeriods = [], assignments, allowDoublePeriods }) {
  const breakSet = new Set(breaksAfterPeriods);
  const classBusy = new Map(); // `${classId}` -> Set of `${day}-${period}`
  const teacherBusy = new Map(); // `${teacherId}` -> Set of `${day}-${period}`
  const classSubjectDay = new Map(); // `${classId}-${day}` -> Set of teachingAssignmentId

  const key = (a, b) => `${a}-${b}`;
  const isFree = (map, entityId, day, periods) => {
    const busy = map.get(String(entityId));
    if (!busy) return true;
    return periods.every((p) => !busy.has(key(day, p)));
  };
  const markBusy = (map, entityId, day, periods) => {
    const k = String(entityId);
    if (!map.has(k)) map.set(k, new Set());
    const busy = map.get(k);
    periods.forEach((p) => busy.add(key(day, p)));
  };

  // Doubles are more constrained (need two consecutive free periods for
  // both the class and the teacher), so place them first while there's
  // the most room left in the grid.
  let units = assignments.flatMap((a) => buildUnits(a, allowDoublePeriods));
  units = [
    ...shuffle(units.filter((u) => u.length === 2)),
    ...shuffle(units.filter((u) => u.length === 1)),
  ];

  const placements = [];
  const unplaced = [];

  for (const unit of units) {
    const { id: teachingAssignmentId, classId, teacherId, length } = unit;
    let placed = false;

    // Two passes: first respecting the "no repeated subject same day"
    // soft constraint, then without it if that leaves no valid slot.
    for (const respectSameDayPreference of [true, false]) {
      if (placed) break;

      for (const day of shuffle(workingDays)) {
        if (placed) break;
        const lastStart = periodsPerDay - length + 1;
        const startCandidates = shuffle(Array.from({ length: lastStart }, (_, i) => i + 1));

        for (const startPeriod of startCandidates) {
          if (length === 2 && breakSet.has(startPeriod)) continue; // would span a break

          const periods = length === 2 ? [startPeriod, startPeriod + 1] : [startPeriod];

          if (!isFree(classBusy, classId, day, periods)) continue;
          if (!isFree(teacherBusy, teacherId, day, periods)) continue;

          if (respectSameDayPreference) {
            const subjectsToday = classSubjectDay.get(key(classId, day));
            if (subjectsToday && subjectsToday.has(teachingAssignmentId)) continue;
          }

          markBusy(classBusy, classId, day, periods);
          markBusy(teacherBusy, teacherId, day, periods);
          const dayKey = key(classId, day);
          if (!classSubjectDay.has(dayKey)) classSubjectDay.set(dayKey, new Set());
          classSubjectDay.get(dayKey).add(teachingAssignmentId);

          placements.push({ teachingAssignmentId, classId, teacherId, dayOfWeek: day, startPeriod, length });
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      unplaced.push({ teachingAssignmentId, classId, teacherId, length });
    }
  }

  return { placements, unplaced };
}

module.exports = { generateTimetable };
