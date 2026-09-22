const { query } = require('../config/db');

// This entire module is global reference data (no school_id, no RLS) —
// every tenant reads the same KICD curriculum tree. The write functions
// below exist so a platform operator (super_admin) can correct mistakes
// in what was seeded, WITHOUT going back to editing the seed script by
// hand — but they are deliberately not exposed to school_admin. Every
// school reads the same rows, so a school_admin editing a typo would
// silently change what every OTHER school sees too. If per-school
// curriculum customization is ever actually needed, that's a different,
// larger feature (forking the tree per school), not this.

async function listEducationLevels() {
  const result = await query(`SELECT * FROM education_levels ORDER BY sort_order`);
  return result.rows;
}

async function listGrades(educationLevelId) {
  const params = [];
  let filter = '';
  if (educationLevelId) {
    params.push(educationLevelId);
    filter = `WHERE education_level_id = $1`;
  }
  const result = await query(`SELECT * FROM grades ${filter} ORDER BY sort_order`, params);
  return result.rows;
}

async function listLearningAreas(gradeId) {
  const result = await query(
    `SELECT * FROM learning_areas WHERE grade_id = $1 ORDER BY name`,
    [gradeId]
  );
  return result.rows;
}

async function listStrands(learningAreaId) {
  const result = await query(
    `SELECT * FROM strands WHERE learning_area_id = $1 ORDER BY name`,
    [learningAreaId]
  );
  return result.rows;
}

async function listSubStrands(strandId) {
  const result = await query(
    `SELECT * FROM sub_strands WHERE strand_id = $1 ORDER BY name`,
    [strandId]
  );
  return result.rows;
}

async function listLearningOutcomes(subStrandId, termNumber) {
  const params = [subStrandId];
  let filter = '';
  if (termNumber) {
    params.push(termNumber);
    filter = `AND term_number = $2`;
  }
  const result = await query(
    `SELECT * FROM learning_outcomes WHERE sub_strand_id = $1 ${filter} ORDER BY term_number`,
    params
  );
  return result.rows;
}

async function listRubricLevels() {
  const result = await query(`SELECT * FROM rubric_levels ORDER BY score_value`);
  return result.rows;
}

// Convenience: the full nested tree for one grade, used by the frontend
// when a teacher is setting up an assessment for a class and needs every
// sub-strand available in one call instead of N+1 round trips.
async function getFullTreeForGrade(gradeId) {
  const result = await query(
    `SELECT la.id AS learning_area_id, la.name AS learning_area_name,
            st.id AS strand_id, st.name AS strand_name,
            ss.id AS sub_strand_id, ss.name AS sub_strand_name
     FROM learning_areas la
     JOIN strands st ON st.learning_area_id = la.id
     JOIN sub_strands ss ON ss.strand_id = st.id
     WHERE la.grade_id = $1
     ORDER BY la.name, st.name, ss.name`,
    [gradeId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------
// Write functions — super_admin only, see the note at the top of this
// file. Plain `query()`, matching every read above: there is no tenant
// context for genuinely global data. Every write is logged to audit_logs
// with school_id NULL (same pattern as user.model.js createSuperAdmin),
// since a change here is platform-wide and worth a trail even though it
// doesn't belong to any one school's own audit history.
// ---------------------------------------------------------------------

async function recordGlobalAudit(userId, action, tableName, recordId, details) {
  await query(
    `INSERT INTO audit_logs (school_id, user_id, action, table_name, record_id, details)
     VALUES (NULL, $1, $2, $3, $4, $5)`,
    [userId || null, action, tableName, recordId || null, JSON.stringify(details || {})]
  );
}

async function createEducationLevel({ name, sortOrder }, actorUserId) {
  const result = await query(
    `INSERT INTO education_levels (name, sort_order) VALUES ($1,$2) RETURNING *`,
    [name, sortOrder]
  );
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'education_levels', row.id, { name });
  return row;
}

async function updateEducationLevel(id, { name, sortOrder }, actorUserId) {
  const result = await query(
    `UPDATE education_levels SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order) WHERE id = $1 RETURNING *`,
    [id, name, sortOrder]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'education_levels', id, { name, sortOrder });
  return result.rows[0] || null;
}

async function deleteEducationLevel(id, actorUserId) {
  const result = await query(`DELETE FROM education_levels WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'education_levels', id, {});
  return result.rows[0] || null;
}

async function createGrade({ educationLevelId, name, sortOrder }, actorUserId) {
  const result = await query(
    `INSERT INTO grades (education_level_id, name, sort_order) VALUES ($1,$2,$3) RETURNING *`,
    [educationLevelId, name, sortOrder]
  );
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'grades', row.id, { educationLevelId, name });
  return row;
}

async function updateGrade(id, { name, sortOrder, educationLevelId }, actorUserId) {
  const result = await query(
    `UPDATE grades SET name = COALESCE($2, name), sort_order = COALESCE($3, sort_order),
                        education_level_id = COALESCE($4, education_level_id)
     WHERE id = $1 RETURNING *`,
    [id, name, sortOrder, educationLevelId]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'grades', id, { name, sortOrder, educationLevelId });
  return result.rows[0] || null;
}

async function deleteGrade(id, actorUserId) {
  const result = await query(`DELETE FROM grades WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'grades', id, {});
  return result.rows[0] || null;
}

async function createLearningArea({ gradeId, name }, actorUserId) {
  const result = await query(`INSERT INTO learning_areas (grade_id, name) VALUES ($1,$2) RETURNING *`, [gradeId, name]);
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'learning_areas', row.id, { gradeId, name });
  return row;
}

async function updateLearningArea(id, { name, gradeId }, actorUserId) {
  const result = await query(
    `UPDATE learning_areas SET name = COALESCE($2, name), grade_id = COALESCE($3, grade_id) WHERE id = $1 RETURNING *`,
    [id, name, gradeId]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'learning_areas', id, { name, gradeId });
  return result.rows[0] || null;
}

async function deleteLearningArea(id, actorUserId) {
  const result = await query(`DELETE FROM learning_areas WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'learning_areas', id, {});
  return result.rows[0] || null;
}

async function createStrand({ learningAreaId, name }, actorUserId) {
  const result = await query(`INSERT INTO strands (learning_area_id, name) VALUES ($1,$2) RETURNING *`, [learningAreaId, name]);
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'strands', row.id, { learningAreaId, name });
  return row;
}

async function updateStrand(id, { name, learningAreaId }, actorUserId) {
  const result = await query(
    `UPDATE strands SET name = COALESCE($2, name), learning_area_id = COALESCE($3, learning_area_id) WHERE id = $1 RETURNING *`,
    [id, name, learningAreaId]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'strands', id, { name, learningAreaId });
  return result.rows[0] || null;
}

async function deleteStrand(id, actorUserId) {
  const result = await query(`DELETE FROM strands WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'strands', id, {});
  return result.rows[0] || null;
}

async function createSubStrand({ strandId, name }, actorUserId) {
  const result = await query(`INSERT INTO sub_strands (strand_id, name) VALUES ($1,$2) RETURNING *`, [strandId, name]);
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'sub_strands', row.id, { strandId, name });
  return row;
}

async function updateSubStrand(id, { name, strandId }, actorUserId) {
  const result = await query(
    `UPDATE sub_strands SET name = COALESCE($2, name), strand_id = COALESCE($3, strand_id) WHERE id = $1 RETURNING *`,
    [id, name, strandId]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'sub_strands', id, { name, strandId });
  return result.rows[0] || null;
}

async function deleteSubStrand(id, actorUserId) {
  const result = await query(`DELETE FROM sub_strands WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'sub_strands', id, {});
  return result.rows[0] || null;
}

async function createLearningOutcome({ subStrandId, termNumber, description }, actorUserId) {
  const result = await query(
    `INSERT INTO learning_outcomes (sub_strand_id, term_number, description) VALUES ($1,$2,$3) RETURNING *`,
    [subStrandId, termNumber, description]
  );
  const row = result.rows[0];
  await recordGlobalAudit(actorUserId, 'create', 'learning_outcomes', row.id, { subStrandId, termNumber });
  return row;
}

async function updateLearningOutcome(id, { termNumber, description }, actorUserId) {
  const result = await query(
    `UPDATE learning_outcomes SET term_number = COALESCE($2, term_number), description = COALESCE($3, description)
     WHERE id = $1 RETURNING *`,
    [id, termNumber, description]
  );
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'learning_outcomes', id, { termNumber, description });
  return result.rows[0] || null;
}

async function deleteLearningOutcome(id, actorUserId) {
  const result = await query(`DELETE FROM learning_outcomes WHERE id = $1 RETURNING id`, [id]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'delete', 'learning_outcomes', id, {});
  return result.rows[0] || null;
}

/**
 * rubric_levels intentionally has no create/delete here, and update is
 * restricted to the `label` (display text) only, never `code` or
 * `score_value`. The four CBC rubric codes (EE/ME/AE/BE) are hardcoded
 * elsewhere in the system — most notably reportCardPdf.util.js's
 * RUBRIC_COLORS map is keyed by exactly those codes — so renaming or
 * removing one would silently break report card rendering rather than
 * failing loudly. If the label has a typo, fix it; if the rubric scheme
 * itself needs to change, that's a coordinated change across this model,
 * reportCardPdf.util.js, and any frontend code that also hardcodes them,
 * not a simple data edit.
 */
async function updateRubricLevelLabel(id, label, actorUserId) {
  const result = await query(`UPDATE rubric_levels SET label = $2 WHERE id = $1 RETURNING *`, [id, label]);
  if (result.rows[0]) await recordGlobalAudit(actorUserId, 'update', 'rubric_levels', id, { label });
  return result.rows[0] || null;
}

module.exports = {
  listEducationLevels, listGrades, listLearningAreas, listStrands,
  listSubStrands, listLearningOutcomes, listRubricLevels, getFullTreeForGrade,
  createEducationLevel, updateEducationLevel, deleteEducationLevel,
  createGrade, updateGrade, deleteGrade,
  createLearningArea, updateLearningArea, deleteLearningArea,
  createStrand, updateStrand, deleteStrand,
  createSubStrand, updateSubStrand, deleteSubStrand,
  createLearningOutcome, updateLearningOutcome, deleteLearningOutcome,
  updateRubricLevelLabel,
};
