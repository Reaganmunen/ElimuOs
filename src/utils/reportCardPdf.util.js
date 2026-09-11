const PDFDocument = require('pdfkit');

const RUBRIC_COLORS = {
  EE: '#16a34a', // Exceeding Expectation — green
  ME: '#2563eb', // Meeting Expectation — blue
  AE: '#d97706', // Approaching Expectation — amber
  BE: '#dc2626', // Below Expectation — red
};

function groupByLearningArea(results) {
  const map = new Map();
  for (const row of results) {
    if (!map.has(row.learning_area_name)) map.set(row.learning_area_name, []);
    map.get(row.learning_area_name).push(row);
  }
  // Alphabetical by learning area for a stable, predictable reading order —
  // the underlying query has no natural grouping order of its own.
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Renders one report card as a PDF and resolves with the complete file as
 * a Buffer. pdfkit is stream-based; collecting into a Buffer (rather than
 * piping straight to the HTTP response) means the caller gets a complete,
 * valid file before anything is sent to the client — a mid-generation
 * crash never leaves a truncated PDF on the wire.
 */
function renderReportCardPdf(bundle) {
  const { school, student, term, results, attendance, remarks } = bundle;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // -- Header --
    doc.fontSize(18).font('Helvetica-Bold').text(school.name, { align: 'center' });
    const contactLine = [school.county, school.phone, school.email].filter(Boolean).join('  |  ');
    if (contactLine) {
      doc.fontSize(9).font('Helvetica').fillColor('#555555').text(contactLine, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
      .text('LEARNER PROGRESS REPORT', { align: 'center' });
    doc.moveDown(1);

    // -- Student info block --
    const classLabel = [student.grade_name, student.stream_name].filter(Boolean).join(' ');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${student.full_name}`, 50, doc.y, { continued: true, width: 250 });
    doc.text(`   Admission No: ${student.admission_number}`);
    doc.x = 50;
    doc.text(`Class: ${classLabel || '—'}`, 50, doc.y, { continued: true, width: 250 });
    doc.text(`   Term: ${term.term_number}, ${term.year_label}`);
    doc.x = 50;
    doc.moveDown(1);

    // -- Rubric key --
    doc.fontSize(8).font('Helvetica-Oblique').fillColor('#555555').text(
      'EE = Exceeding Expectation   ME = Meeting Expectation   AE = Approaching Expectation   BE = Below Expectation',
    );
    doc.moveDown(0.5);
    doc.fillColor('#000000');

    // -- Results table, grouped by learning area --
    const grouped = groupByLearningArea(results);
    const colX = { substrand: 50, level: 340, remark: 400 };
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    if (grouped.length === 0) {
      doc.fontSize(10).font('Helvetica-Oblique').text('No assessment results recorded for this term yet.');
      doc.moveDown(1);
    }

    for (const [learningAreaName, rows] of grouped) {
      if (doc.y > pageBottom - 80) doc.addPage();

      doc.fontSize(11).font('Helvetica-Bold').fillColor('#1f2937').text(learningAreaName, 50, doc.y);
      doc.moveDown(0.2);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
      doc.moveDown(0.3);

      for (const row of rows) {
        if (doc.y > pageBottom - 40) doc.addPage();
        const rowTop = doc.y;

        doc.fontSize(9).font('Helvetica').fillColor('#000000')
          .text(`${row.strand_name} — ${row.sub_strand_name}`, colX.substrand, rowTop, { width: 280 });

        doc.font('Helvetica-Bold').fillColor(RUBRIC_COLORS[row.rubric_code] || '#000000')
          .text(row.rubric_code, colX.level, rowTop, { width: 40 });

        if (row.teacher_remark) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
            .text(row.teacher_remark, colX.remark, rowTop, { width: 145 });
        }

        // The explicit-position .text() calls above (colX.level, colX.remark)
        // leave pdfkit's internal cursor (doc.x) wherever that last call put
        // it, rather than resetting to the page's left margin the way a
        // normal in-flow .text() call would. Without this reset, every
        // subsequent un-positioned .text() call downstream — the Attendance
        // and Remarks section headers — silently inherits that drifted x
        // and renders shifted right instead of at the margin.
        doc.x = doc.page.margins.left;
        doc.fillColor('#000000');
        doc.moveDown(0.4);
      }
      doc.moveDown(0.5);
    }

    // -- Attendance --
    if (doc.y > pageBottom - 100) doc.addPage();
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text('Attendance', 50, doc.y);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').text(
      `Present: ${attendance.present}   Absent: ${attendance.absent}   Late: ${attendance.late}   `
      + `Excused: ${attendance.excused}   Attendance Rate: ${attendance.presentRatePercent != null ? `${attendance.presentRatePercent}%` : 'N/A'}`,
      50, doc.y,
    );
    doc.moveDown(1);

    // -- Remarks --
    if (doc.y > pageBottom - 100) doc.addPage();
    doc.x = 50;
    doc.fontSize(11).font('Helvetica-Bold').text('Remarks', 50, doc.y);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#d1d5db').stroke();
    doc.moveDown(0.3);
    doc.x = 50;
    doc.fontSize(9).font('Helvetica-Bold').text('Class Teacher: ', 50, doc.y, { continued: true })
      .font('Helvetica').text(remarks.class_teacher_remark || '—');
    doc.moveDown(0.3);
    doc.x = 50;
    doc.font('Helvetica-Bold').text('Head Teacher: ', 50, doc.y, { continued: true })
      .font('Helvetica').text(remarks.head_teacher_remark || '—');

    // -- Footer --
    doc.fontSize(7).fillColor('#999999')
      .text(`Generated on ${new Date().toISOString().slice(0, 10)}`, 50, pageBottom - 20, { align: 'left' });

    doc.end();
  });
}

module.exports = { renderReportCardPdf };