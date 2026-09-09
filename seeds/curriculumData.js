/**
 * CBC/CBE curriculum reference data for seeding.
 *
 * CONFIDENCE LEVELS — read before trusting this in production:
 *
 * - educationLevels, grades: VERIFIED structurally against kicd.ac.ke's own
 *   download categories (Pre-Primary, Lower Primary, Upper Primary/"Grade
 *   Four/Five/Six Designs", Junior School/"Grade Seven/Eight/Nine Designs").
 *   Safe to trust.
 *
 * - learningAreasByLevel: BEST-EFFORT reconstruction from multiple secondary
 *   sources, NOT verified against the actual KICD PDF designs. Sources
 *   disagreed on the exact count of Junior School compulsory learning areas
 *   (conflicting reports of 9, 12, and 13) — likely reflecting the 2024
 *   curriculum rationalisation that some articles have and others don't.
 *   CONFIRM against the current Grade 7/8/9 curriculum designs at
 *   https://kicd.ac.ke/cbc-materials/curriculum-designs/ before relying on
 *   this list for a real school.
 *
 * - strandsAndSubStrands: only ONE learning area is populated as a worked
 *   example (Grade 7 Mathematics), reconstructed from secondary sources
 *   describing real KICD design documents. Reasonably corroborated for the
 *   Numbers/Algebra/Measurement strands; the Geometry and Data Handling
 *   sub-strand lists are lower-confidence and should be checked against the
 *   actual design PDF. Every other learning area/grade combination is left
 *   as an empty array for you (or a data-entry pass against the real PDFs)
 *   to fill in using the same shape.
 */

const educationLevels = [
  { name: 'Pre-Primary', sortOrder: 1 },
  { name: 'Lower Primary', sortOrder: 2 },
  { name: 'Upper Primary', sortOrder: 3 },
  { name: 'Junior School', sortOrder: 4 },
];

const grades = [
  { name: 'PP1', level: 'Pre-Primary', sortOrder: 1 },
  { name: 'PP2', level: 'Pre-Primary', sortOrder: 2 },
  { name: 'Grade 1', level: 'Lower Primary', sortOrder: 3 },
  { name: 'Grade 2', level: 'Lower Primary', sortOrder: 4 },
  { name: 'Grade 3', level: 'Lower Primary', sortOrder: 5 },
  { name: 'Grade 4', level: 'Upper Primary', sortOrder: 6 },
  { name: 'Grade 5', level: 'Upper Primary', sortOrder: 7 },
  { name: 'Grade 6', level: 'Upper Primary', sortOrder: 8 },
  { name: 'Grade 7', level: 'Junior School', sortOrder: 9 },
  { name: 'Grade 8', level: 'Junior School', sortOrder: 10 },
  { name: 'Grade 9', level: 'Junior School', sortOrder: 11 },
];

// UNVERIFIED against the primary source — see confidence note above.
const learningAreasByLevel = {
  'Pre-Primary': [
    'Language Activities', 'Mathematical Activities', 'Environmental Activities',
    'Psychomotor and Creative Activities', 'Religious Education Activities',
  ],
  'Lower Primary': [
    'Indigenous Language / Kenyan Sign Language', 'Kiswahili Language Activities / KSL',
    'English Language Activities', 'Mathematical Activities', 'Religious Education Activities',
    'Environmental Activities', 'Creative Activities', 'Physical and Health Education',
  ],
  'Upper Primary': [
    'English', 'Kiswahili / Kenyan Sign Language', 'Mathematics', 'Religious Education',
    'Science and Technology', 'Agriculture and Nutrition', 'Social Studies',
    'Creative Arts', 'Physical and Health Education',
  ],
  // Junior School count is the specific point of source disagreement — verify this list.
  'Junior School': [
    'English', 'Kiswahili / Kenyan Sign Language', 'Mathematics', 'Religious Education',
    'Integrated Science', 'Health Education', 'Pre-Technical Studies', 'Social Studies',
    'Agriculture', 'Life Skills Education', 'Physical Education',
  ],
};

// Worked example only — see confidence note above. Shape: for each entry,
// { grade, learningArea, strands: [{ name, subStrands: [string, ...] }] }
const strandsAndSubStrands = [
  {
    grade: 'Grade 7',
    learningArea: 'Mathematics',
    strands: [
      {
        name: 'Numbers',
        subStrands: ['Whole Numbers', 'Factors', 'Fractions', 'Decimals', 'Squares and Square Roots'],
      },
      {
        name: 'Algebra',
        subStrands: ['Algebraic Expressions', 'Linear Equations', 'Inequalities'],
      },
      {
        name: 'Measurement',
        subStrands: ['Length', 'Area', 'Volume and Capacity', 'Mass', 'Time', 'Money'],
      },
      {
        // Lower confidence — verify sub-strand names against the actual design.
        name: 'Geometry',
        subStrands: ['Angles', 'Lines and Line Segments', 'Geometric Construction'],
      },
      {
        // Lower confidence — verify sub-strand names against the actual design.
        name: 'Data Handling and Probability',
        subStrands: ['Data Collection and Organisation', 'Data Representation', 'Probability'],
      },
    ],
  },
  // Add more { grade, learningArea, strands } entries here as you verify
  // them against the real KICD curriculum design PDFs — the loader in
  // seedCurriculum.js is idempotent, so re-running it after adding more
  // entries only inserts what's new.
];

module.exports = { educationLevels, grades, learningAreasByLevel, strandsAndSubStrands };
