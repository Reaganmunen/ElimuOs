const { query } = require('../config/db');

// This entire module is global reference data (no school_id, no RLS) —
// every tenant reads the same KICD curriculum tree. Writes to this data
// happen via a seed script, not through the API, so only read functions
// are exposed here.

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

module.exports = {
  listEducationLevels, listGrades, listLearningAreas, listStrands,
  listSubStrands, listLearningOutcomes, listRubricLevels, getFullTreeForGrade,
};
