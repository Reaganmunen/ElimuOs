require('dotenv').config();
const { query, pool } = require('../src/config/db');
const {
  educationLevels, grades, learningAreasByLevel, strandsAndSubStrands,
} = require('./curriculumData');

// Every helper below is find-or-create: SELECT first, INSERT only if
// missing. This makes the whole script safe to re-run after you add more
// entries to curriculumData.js — it will never create duplicates, and only
// reports what's newly inserted.

async function findOrCreateEducationLevel(name, sortOrder) {
  const existing = await query(`SELECT id FROM education_levels WHERE name = $1`, [name]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const inserted = await query(
    `INSERT INTO education_levels (name, sort_order) VALUES ($1,$2) RETURNING id`,
    [name, sortOrder]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function findOrCreateGrade(name, educationLevelId, sortOrder) {
  const existing = await query(`SELECT id FROM grades WHERE name = $1 AND education_level_id = $2`, [name, educationLevelId]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const inserted = await query(
    `INSERT INTO grades (name, education_level_id, sort_order) VALUES ($1,$2,$3) RETURNING id`,
    [name, educationLevelId, sortOrder]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function findOrCreateLearningArea(name, gradeId) {
  const existing = await query(`SELECT id FROM learning_areas WHERE name = $1 AND grade_id = $2`, [name, gradeId]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const inserted = await query(
    `INSERT INTO learning_areas (name, grade_id) VALUES ($1,$2) RETURNING id`,
    [name, gradeId]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function findOrCreateStrand(name, learningAreaId) {
  const existing = await query(`SELECT id FROM strands WHERE name = $1 AND learning_area_id = $2`, [name, learningAreaId]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const inserted = await query(
    `INSERT INTO strands (name, learning_area_id) VALUES ($1,$2) RETURNING id`,
    [name, learningAreaId]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function findOrCreateSubStrand(name, strandId) {
  const existing = await query(`SELECT id FROM sub_strands WHERE name = $1 AND strand_id = $2`, [name, strandId]);
  if (existing.rows.length > 0) return { id: existing.rows[0].id, created: false };
  const inserted = await query(
    `INSERT INTO sub_strands (name, strand_id) VALUES ($1,$2) RETURNING id`,
    [name, strandId]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function seed() {
  const stats = { levels: 0, grades: 0, learningAreas: 0, strands: 0, subStrands: 0 };
  const levelIdByName = {};
  const gradeIdByName = {};

  console.log('Seeding education levels...');
  for (const level of educationLevels) {
    const result = await findOrCreateEducationLevel(level.name, level.sortOrder);
    levelIdByName[level.name] = result.id;
    if (result.created) stats.levels += 1;
  }

  console.log('Seeding grades...');
  for (const grade of grades) {
    const levelId = levelIdByName[grade.level];
    if (!levelId) {
      throw new Error(`Grade "${grade.name}" references unknown education level "${grade.level}"`);
    }
    const result = await findOrCreateGrade(grade.name, levelId, grade.sortOrder);
    gradeIdByName[grade.name] = result.id;
    if (result.created) stats.grades += 1;
  }

  console.log('Seeding learning areas...');
  const learningAreaIdByGradeAndName = {};
  for (const [levelName, areaNames] of Object.entries(learningAreasByLevel)) {
    const gradesInLevel = grades.filter((g) => g.level === levelName);
    for (const grade of gradesInLevel) {
      const gradeId = gradeIdByName[grade.name];
      for (const areaName of areaNames) {
        const result = await findOrCreateLearningArea(areaName, gradeId);
        learningAreaIdByGradeAndName[`${grade.name}::${areaName}`] = result.id;
        if (result.created) stats.learningAreas += 1;
      }
    }
  }

  console.log('Seeding strands and sub-strands (worked examples only)...');
  for (const entry of strandsAndSubStrands) {
    const learningAreaId = learningAreaIdByGradeAndName[`${entry.grade}::${entry.learningArea}`];
    if (!learningAreaId) {
      console.warn(`  Skipping "${entry.learningArea}" for ${entry.grade} — learning area was not seeded above (check spelling matches learningAreasByLevel exactly)`);
      continue; // eslint-disable-line no-continue
    }
    for (const strand of entry.strands) {
      const strandResult = await findOrCreateStrand(strand.name, learningAreaId);
      if (strandResult.created) stats.strands += 1;
      for (const subStrandName of strand.subStrands) {
        const subResult = await findOrCreateSubStrand(subStrandName, strandResult.id);
        if (subResult.created) stats.subStrands += 1;
      }
    }
  }

  console.log('\nDone. Newly created this run:');
  console.table(stats);
  console.log('\nReminder: learningAreasByLevel and strandsAndSubStrands in curriculumData.js');
  console.log('are not yet verified against the actual KICD curriculum design PDFs — see the');
  console.log('confidence notes at the top of that file before relying on this in production.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    pool.end().finally(() => process.exit(1));
  });
