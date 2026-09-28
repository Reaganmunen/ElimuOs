/**
 * One-off / operator-only script to add missing strands and sub-strands
 * to the global curriculum tree (see curriculum.model.js for why this is
 * super_admin-only and shared across every school, rather than something
 * school_admin can edit).
 *
 * There's no UI for this yet, so this script is the practical way to
 * unblock a teacher who can't select a sub-strand when grading: it means
 * those rows don't exist yet for that grade/learning area. Run this
 * against the real database from a trusted machine, the same way you'd
 * run createSuperAdmin.js.
 *
 * It's idempotent — safe to re-run. It looks up grades and learning areas
 * by name (they should already exist, since a teacher can only be
 * assigned a learning area that's already set up), and for each strand /
 * sub-strand it only creates the row if one with that name doesn't
 * already exist under the right parent. Every write still goes through
 * curriculum.model.js, so it's audited exactly like an API call would be.
 *
 * Usage:
 *   node scripts/seedCurriculum.js --file curriculum-seed.json --actor-email you@yourcompany.com
 *
 * Input file shape (see curriculum-seed.example.json alongside this script):
 * [
 *   {
 *     "grade": "Grade 4",
 *     "learningArea": "Mathematics",
 *     "strands": [
 *       { "strand": "Numbers", "subStrands": ["Whole Numbers", "Fractions"] }
 *     ]
 *   }
 * ]
 *
 * --actor-email is optional but recommended — it's whoever the audit log
 * should say made the change. Without it, audit rows are recorded with a
 * null user_id (still logged, just not attributed to a person).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const userModel = require('../models/user.model');
const curriculumModel = require('../models/curriculum.model');
const { pool } = require('../config/db');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const norm = (s) => String(s || '').trim().toLowerCase();

async function resolveActor(email) {
  if (!email) return null;
  const matches = await userModel.findByEmailAcrossSchools(email);
  const superAdmin = matches.find((u) => u.role_code === 'super_admin');
  if (!superAdmin) {
    throw new Error(`No super_admin found with email ${email}`);
  }
  return superAdmin.id;
}

async function resolveGradeId(gradeName) {
  const grades = await curriculumModel.listGrades();
  const match = grades.find((g) => norm(g.name) === norm(gradeName));
  if (!match) throw new Error(`Grade not found: "${gradeName}". Create it first (or check spelling).`);
  return match.id;
}

async function resolveLearningAreaId(gradeId, learningAreaName) {
  const areas = await curriculumModel.listLearningAreas(gradeId);
  const match = areas.find((a) => norm(a.name) === norm(learningAreaName));
  if (!match) throw new Error(`Learning area not found: "${learningAreaName}" for that grade. Create it first (or check spelling).`);
  return match.id;
}

async function upsertStrand(learningAreaId, strandName, actorUserId) {
  const existing = await curriculumModel.listStrands(learningAreaId);
  const match = existing.find((s) => norm(s.name) === norm(strandName));
  if (match) return { id: match.id, created: false };
  const row = await curriculumModel.createStrand({ learningAreaId, name: strandName }, actorUserId);
  return { id: row.id, created: true };
}

async function upsertSubStrand(strandId, subStrandName, actorUserId) {
  const existing = await curriculumModel.listSubStrands(strandId);
  const match = existing.find((s) => norm(s.name) === norm(subStrandName));
  if (match) return { id: match.id, created: false };
  const row = await curriculumModel.createSubStrand({ strandId, name: subStrandName }, actorUserId);
  return { id: row.id, created: true };
}

async function main() {
  const args = parseArgs();
  if (!args.file) {
    console.error('Usage: node scripts/seedCurriculum.js --file curriculum-seed.json [--actor-email you@yourcompany.com]');
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(process.cwd(), args.file);
  const spec = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  let actorUserId;
  try {
    actorUserId = await resolveActor(args['actor-email']);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  let strandsCreated = 0;
  let subStrandsCreated = 0;

  try {
    for (const entry of spec) {
      const gradeId = await resolveGradeId(entry.grade);
      const learningAreaId = await resolveLearningAreaId(gradeId, entry.learningArea);

      for (const strandEntry of entry.strands || []) {
        const strand = await upsertStrand(learningAreaId, strandEntry.strand, actorUserId);
        if (strand.created) strandsCreated += 1;
        console.log(`${strand.created ? 'created' : 'exists '} strand   "${strandEntry.strand}" (${entry.grade} / ${entry.learningArea})`);

        for (const subStrandName of strandEntry.subStrands || []) {
          const sub = await upsertSubStrand(strand.id, subStrandName, actorUserId);
          if (sub.created) subStrandsCreated += 1;
          console.log(`  ${sub.created ? 'created' : 'exists '} sub-strand "${subStrandName}"`);
        }
      }
    }
    console.log(`\nDone. ${strandsCreated} strand(s) and ${subStrandsCreated} sub-strand(s) created.`);
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
