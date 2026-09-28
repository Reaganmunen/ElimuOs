const { withTenantClient } = require('../config/db');

/**
 * Groups active students under each linked guardian, with what they owe. A child with two guardians
 * appears under both, so don't add family totals together across the whole list.
 */
async function listFamilies(schoolId, { q, onlyOwing, siblings, limit = 200 } = {}) {
  return withTenantClient(schoolId, async (client) => {
    const links = await client.query(
      `SELECT g.id AS guardian_id, g.full_name AS guardian_name, g.phone, sg.relationship, sg.is_primary_contact,
              s.id AS student_id, s.full_name AS student_name, s.admission_number
       FROM guardians g
       JOIN student_guardians sg ON sg.guardian_id = g.id
       JOIN students s ON s.id = sg.student_id
       WHERE g.school_id = $1 AND s.school_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'`,
      [schoolId]
    );
    const open = await client.query(
      `SELECT i.id, i.student_id, (i.total_amount - i.amount_paid) AS balance, i.due_date, t.term_number
       FROM invoices i JOIN terms t ON t.id = i.term_id
       WHERE i.school_id = $1 AND i.total_amount - i.amount_paid > 0.005
       ORDER BY i.due_date ASC NULLS LAST`,
      [schoolId]
    );
    const byStudent = new Map();
    open.rows.forEach((r) => {
      const list = byStudent.get(String(r.student_id)) || [];
      list.push({ id: r.id, balance: Number(r.balance), due_date: r.due_date, term_number: r.term_number });
      byStudent.set(String(r.student_id), list);
    });

    const families = new Map();
    links.rows.forEach((l) => {
      const f = families.get(String(l.guardian_id)) || { id: l.guardian_id, name: l.guardian_name, phone: l.phone, students: [], owed: 0 };
      const invoices = byStudent.get(String(l.student_id)) || [];
      const owed = invoices.reduce((t, i) => t + i.balance, 0);
      f.students.push({ id: l.student_id, name: l.student_name, admission_number: l.admission_number, relationship: l.relationship, owed, invoices });
      f.owed += owed;
      families.set(String(l.guardian_id), f);
    });

    const needle = q ? String(q).trim().toLowerCase() : '';
    let out = [...families.values()];
    if (needle) {
      out = out.filter((f) => f.name.toLowerCase().includes(needle) || String(f.phone || '').includes(needle)
        || f.students.some((s) => s.name.toLowerCase().includes(needle) || s.admission_number.toLowerCase().includes(needle)));
    }
    if (onlyOwing) out = out.filter((f) => f.owed > 0);
    if (siblings) out = out.filter((f) => f.students.length > 1);
    out.sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
    return { items: out.slice(0, limit), total: out.length };
  });
}

module.exports = { listFamilies };