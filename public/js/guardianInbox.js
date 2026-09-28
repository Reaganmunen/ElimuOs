/**
 * ElimuOs — staff-side guardian inbox, shared by the admin and teacher pages.
 *
 *   ElimuOs.guardianInbox.mountEnquiries(el, { isAdmin })   enquiries guardians sent (reply / forward)
 *   ElimuOs.guardianInbox.mountAbsences(el,  { isAdmin })   absence / late / early-pickup notices
 *   ElimuOs.guardianInbox.summary()                         { openEnquiries, pendingAbsences }
 *
 * Admin sees everything and can forward an enquiry to a teacher. A teacher sees
 * only enquiries forwarded to them and notices for their own class — the server
 * enforces that; this file just renders what it gets back.
 * Needs api.js loaded first. Injects its own styles + modal, so pages only need a container.
 */
(function () {
  const api = () => window.ElimuOs.api;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (v) => (v ? String(v).slice(0, 10) : '');
  const when = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const cls = (r) => (r.grade_name ? `${r.grade_name}${r.stream_name ? ' ' + r.stream_name : ''}` : '');
  const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const RELATION = { class_teacher: 'Class teacher', subject_teacher: 'Subject teacher', other: 'Other teachers' };

  function injectOnce() {
    if (document.getElementById('gi-style')) return;
    const st = document.createElement('style');
    st.id = 'gi-style';
    st.textContent = `
      .gi-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}
      .gi-filters .field{margin-bottom:0;min-width:170px}
      .gi-table{width:100%;border-collapse:collapse;font-size:.88rem}
      .gi-table th{text-align:left;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);font-weight:700;padding:0 12px 10px;border-bottom:1px solid var(--line)}
      .gi-table td{padding:12px;border-bottom:1px solid var(--line);vertical-align:top}
      .gi-table tr:last-child td{border-bottom:none}
      .gi-table tr.gi-click{cursor:pointer} .gi-table tr.gi-click:hover{background:var(--cloud)}
      .gi-title{font-weight:700} .gi-muted{color:var(--ink-soft);font-size:.82rem}
      .gi-empty{text-align:center;padding:36px 20px;color:var(--ink-soft)}
      .gi-empty i{font-size:1.8rem;display:block;margin-bottom:8px;color:var(--line)}
      .gi-err{font-size:.82rem;color:#B23350;background:rgba(240,99,122,.09);border-radius:var(--radius-sm);padding:10px 13px;margin-bottom:14px;display:none}
      .gi-err.shown{display:block}
      .gi-msg{white-space:pre-wrap;background:var(--cloud);border-radius:var(--radius-sm);padding:12px 14px;font-size:.9rem;line-height:1.5;margin:6px 0 14px}
      .gi-reply{white-space:pre-wrap;background:rgba(23,166,115,.08);border-radius:var(--radius-sm);padding:12px 14px;font-size:.9rem;line-height:1.5;margin:6px 0 14px}
      .gi-sec{font:700 .78rem 'Plus Jakarta Sans',sans-serif;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 6px}
      .gi-box{max-width:600px;max-height:90vh;overflow-y:auto}
      .gi-fwd{border:1.5px dashed var(--line);border-radius:var(--radius-sm);padding:14px;margin-top:6px}
      .gi-toast{position:fixed;bottom:24px;right:24px;background:var(--ink);color:#fff;padding:12px 18px;border-radius:12px;font-size:.88rem;z-index:2000}
      .gi-textarea{min-height:100px;resize:vertical;line-height:1.5}
    `;
    document.head.appendChild(st);
    const m = document.createElement('div');
    m.className = 'modal-overlay'; m.id = 'giModal'; m.style.display = 'none';
    m.innerHTML = '<div class="modal-box gi-box" id="giModalBox"></div>';
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
  }
  const openModal = (html) => { document.getElementById('giModalBox').innerHTML = html; document.getElementById('giModal').style.display = 'flex'; };
  const closeModal = () => { document.getElementById('giModal').style.display = 'none'; };
  function toast(msg) { const t = document.createElement('div'); t.className = 'gi-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
  const skeleton = '<div class="skeleton" style="height:14px;margin:12px 0;"></div>'.repeat(4);
  const chip = (kind, text) => `<span class="status-chip ${kind}">${esc(text)}</span>`;
  const setErr = (id, msg) => { const el = document.getElementById(id); if (!el) return; el.textContent = msg || ''; el.classList.toggle('shown', !!msg); };

  async function summary() { return (await api().apiFetch('/guardian-requests/summary')).data; }

  // =============================== Enquiries ===============================
  function mountEnquiries(el, { isAdmin = false, onChange } = {}) {
    injectOnce();
    let rows = [];
    const F = { status: 'open', assigned: '' };

    el.innerHTML = `
      <div class="gi-filters">
        <div class="field"><label>Show</label><select class="input" data-f="status">
          <option value="open">Waiting for a reply</option><option value="answered">Answered</option><option value="">All</option></select></div>
        ${isAdmin ? `<div class="field"><label>Assignment</label><select class="input" data-f="assigned">
          <option value="">Everyone's</option><option value="unassigned">Not forwarded yet</option><option value="forwarded">Forwarded to a teacher</option></select></div>` : ''}
      </div>
      <div class="card-elimu" data-body>${skeleton}</div>`;
    const body = el.querySelector('[data-body]');
    el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { F[s.dataset.f] = s.value; load(); }));

    async function load() {
      body.innerHTML = skeleton;
      try {
        const q = new URLSearchParams();
        if (F.status) q.set('status', F.status);
        if (F.assigned) q.set('assigned', F.assigned);
        rows = (await api().apiFetch(`/guardian-requests/enquiries?${q}`)).data;
        render();
      } catch (e) { body.innerHTML = `<div class="gi-empty">${esc(e.message || 'Could not load enquiries.')}</div>`; }
    }

    function render() {
      if (!rows.length) {
        body.innerHTML = `<div class="gi-empty"><i class="bi bi-inbox"></i>${isAdmin ? 'No enquiries here.' : 'Nothing has been forwarded to you.'}</div>`;
        return;
      }
      body.innerHTML = `<div style="overflow-x:auto"><table class="gi-table"><thead><tr><th>Subject</th><th>From</th><th>Received</th><th>Status</th>${isAdmin ? '<th>Handled by</th>' : ''}</tr></thead><tbody>
        ${rows.map((r) => `<tr class="gi-click" data-id="${esc(r.id)}">
          <td><div class="gi-title">${esc(r.subject)}</div><div class="gi-muted">${esc(String(r.body).slice(0, 70))}${String(r.body).length > 70 ? '…' : ''}</div></td>
          <td>${esc(r.guardian_name)}<div class="gi-muted">${r.student_name ? esc(r.student_name) + (cls(r) ? ' · ' + esc(cls(r)) : '') : 'General'}</div></td>
          <td class="gi-muted">${esc(when(r.created_at))}</td>
          <td>${r.status === 'open' ? chip('warn', 'Waiting') : r.status === 'answered' ? chip('ok', 'Answered') : chip('info', pretty(r.status))}</td>
          ${isAdmin ? `<td class="gi-muted">${r.assigned_to_name ? '<i class="bi bi-arrow-right-circle"></i> ' + esc(r.assigned_to_name) : 'Admin'}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>`;
      body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openEnquiry(tr.dataset.id)));
    }

    async function openEnquiry(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      if (!r) return;
      const answered = !!r.reply;
      openModal(`
        <h3>${esc(r.subject)}</h3>
        <p class="gi-muted" style="margin:2px 0 10px;">From <b>${esc(r.guardian_name)}</b>${r.guardian_phone ? ' · ' + esc(r.guardian_phone) : ''}${r.student_name ? ' · about ' + esc(r.student_name) + (cls(r) ? ' (' + esc(cls(r)) + ')' : '') : ''} · ${esc(when(r.created_at))}</p>
        <div class="gi-msg">${esc(r.body)}</div>
        ${r.assigned_to_name ? `<p class="gi-muted"><i class="bi bi-arrow-right-circle"></i> Forwarded to <b>${esc(r.assigned_to_name)}</b>${r.forwarded_by_name ? ' by ' + esc(r.forwarded_by_name) : ''}${r.forward_note ? ' — “' + esc(r.forward_note) + '”' : ''}</p>` : ''}
        ${answered ? `<div class="gi-sec">Reply sent${r.replied_by_name ? ' by ' + esc(r.replied_by_name) : ''} · ${esc(when(r.replied_at))}</div><div class="gi-reply">${esc(r.reply)}</div>` : ''}
        <div class="gi-err" id="giErr"></div>
        <div class="gi-sec">${answered ? 'Send another reply' : 'Reply to guardian'}</div>
        <textarea class="input gi-textarea" id="giReply" maxlength="2000" placeholder="Write your reply — the guardian sees it in their portal."></textarea>
        <div class="modal-actions" style="margin-top:12px;"><button type="button" class="btn-elimu btn-elimu-ghost" id="giClose">Close</button>
          <button type="button" class="btn-elimu btn-elimu-primary" id="giSend"><i class="bi bi-send-fill"></i> Send reply</button></div>
        ${isAdmin ? `<div class="gi-sec">Forward to a teacher</div>
          <div class="gi-fwd" id="giFwd"><span class="gi-muted">Loading teachers…</span></div>` : ''}`);
      document.getElementById('giClose').onclick = closeModal;
      document.getElementById('giSend').onclick = () => sendReply(r);
      if (isAdmin) loadTargets(r);
    }

    async function sendReply(r) {
      const text = document.getElementById('giReply').value.trim();
      setErr('giErr', null);
      if (text.length < 2) return setErr('giErr', 'Write a reply first.');
      const btn = document.getElementById('giSend'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await api().apiFetch(`/guardian-requests/enquiries/${encodeURIComponent(r.id)}/reply`, { method: 'POST', body: JSON.stringify({ reply: text }) });
        closeModal(); toast('Reply sent'); await load(); if (onChange) onChange();
      } catch (e) { setErr('giErr', e.message || 'Could not send the reply.'); btn.disabled = false; btn.innerHTML = '<i class="bi bi-send-fill"></i> Send reply'; }
    }

    async function loadTargets(r) {
      const box = document.getElementById('giFwd');
      try {
        const t = (await api().apiFetch(`/guardian-requests/enquiries/${encodeURIComponent(r.id)}/forward-targets`)).data;
        if (!t.length) { box.innerHTML = '<span class="gi-muted">No active teachers to forward to.</span>'; return; }
        const groups = ['class_teacher', 'subject_teacher', 'other'].map((k) => {
          const list = t.filter((x) => x.relation === k);
          return list.length ? `<optgroup label="${RELATION[k]}">${list.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(r.assigned_to) ? 'selected' : ''}>${esc(x.full_name)}</option>`).join('')}</optgroup>` : '';
        }).join('');
        box.innerHTML = `
          <div class="field"><label>Teacher</label><select class="input" id="giTeacher">${groups}</select></div>
          <div class="field"><label>Note for the teacher <span class="gi-muted">(optional)</span></label><input class="input" id="giNote" maxlength="500" placeholder="e.g. Please follow up on this before Friday"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            ${r.assigned_to ? '<button type="button" class="btn-elimu btn-elimu-ghost" id="giUnassign">Take it back</button>' : ''}
            <button type="button" class="btn-elimu btn-elimu-ghost" id="giForward"><i class="bi bi-arrow-right-circle"></i> ${r.assigned_to ? 'Forward to someone else' : 'Forward'}</button>
          </div>`;
        document.getElementById('giForward').onclick = () => act(`/forward`, { teacherId: document.getElementById('giTeacher').value, note: document.getElementById('giNote').value.trim() }, 'giForward', 'Enquiry forwarded');
        const u = document.getElementById('giUnassign');
        if (u) u.onclick = () => act(`/unassign`, {}, 'giUnassign', 'Enquiry taken back');
        async function act(path, payload, btnId, okMsg) {
          setErr('giErr', null);
          const btn = document.getElementById(btnId); btn.disabled = true;
          try {
            await api().apiFetch(`/guardian-requests/enquiries/${encodeURIComponent(r.id)}${path}`, { method: 'POST', body: JSON.stringify(payload) });
            closeModal(); toast(okMsg); await load(); if (onChange) onChange();
          } catch (e) { setErr('giErr', e.message || 'That did not work.'); btn.disabled = false; }
        }
      } catch (e) { box.innerHTML = `<span class="gi-muted">${esc(e.message || 'Could not load teachers.')}</span>`; }
    }

    load();
    return { reload: load };
  }

  // ============================ Absence notices ============================
  function mountAbsences(el, { isAdmin = false, onChange } = {}) {
    injectOnce();
    let rows = [];
    const F = { status: 'submitted', date: '' };

    el.innerHTML = `
      <div class="gi-filters">
        <div class="field"><label>Show</label><select class="input" data-f="status">
          <option value="submitted">Not yet acknowledged</option><option value="acknowledged">Acknowledged</option><option value="">All</option></select></div>
        <div class="field"><label>Affecting date</label><input class="input" type="date" data-f="date"></div>
      </div>
      <div class="card-elimu" data-body>${skeleton}</div>`;
    const body = el.querySelector('[data-body]');
    el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { F[s.dataset.f] = s.value; load(); }));

    async function load() {
      body.innerHTML = skeleton;
      try {
        const q = new URLSearchParams();
        if (F.status) q.set('status', F.status);
        if (F.date) q.set('date', F.date);
        rows = (await api().apiFetch(`/guardian-requests/absences?${q}`)).data;
        render();
      } catch (e) { body.innerHTML = `<div class="gi-empty">${esc(e.message || 'Could not load notices.')}</div>`; }
    }

    function render() {
      if (!rows.length) { body.innerHTML = `<div class="gi-empty"><i class="bi bi-check2-circle"></i>No notices to show.</div>`; return; }
      body.innerHTML = `<div style="overflow-x:auto"><table class="gi-table"><thead><tr><th>Student</th><th>Notice</th><th>Dates</th><th>Reason</th><th>Guardian</th><th></th></tr></thead><tbody>
        ${rows.map((r) => {
          const a = day(r.date_from), b = day(r.date_to);
          return `<tr>
          <td><div class="gi-title">${esc(r.student_name)}</div><div class="gi-muted">${esc(cls(r))}${r.admission_number ? ' · ' + esc(r.admission_number) : ''}</div></td>
          <td>${chip('info', pretty(r.report_type))}${r.expected_time ? `<div class="gi-muted">${esc(String(r.expected_time).slice(0, 5))}</div>` : ''}</td>
          <td class="gi-muted">${esc(a)}${b && b !== a ? ' → ' + esc(b) : ''}</td>
          <td style="max-width:260px;">${esc(r.reason)}${r.staff_note ? `<div class="gi-muted">Note: ${esc(r.staff_note)}</div>` : ''}</td>
          <td>${esc(r.guardian_name)}<div class="gi-muted">${esc(r.guardian_phone || '')}</div></td>
          <td style="white-space:nowrap;">${r.status === 'submitted'
            ? `<button type="button" class="btn-elimu btn-elimu-ghost" data-ack="${esc(r.id)}">Acknowledge</button>`
            : chip('ok', 'Acknowledged') + (r.acknowledged_by_name ? `<div class="gi-muted">${esc(r.acknowledged_by_name)}</div>` : '')}</td>
        </tr>`;
        }).join('')}</tbody></table></div>`;
      body.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', () => askAck(b.dataset.ack)));
    }

    function askAck(id) {
      const r = rows.find((x) => String(x.id) === String(id));
      openModal(`
        <h3>Acknowledge notice</h3>
        <p class="gi-muted" style="margin-bottom:12px;">${esc(r.student_name)} — ${esc(pretty(r.report_type))} (${esc(day(r.date_from))}). The guardian will see it was received.</p>
        <div class="gi-err" id="giErr"></div>
        <div class="field"><label>Note <span class="gi-muted">(optional)</span></label><input class="input" id="giAckNote" maxlength="500" placeholder="e.g. Noted, please send a doctor's note when back"></div>
        <div class="modal-actions"><button type="button" class="btn-elimu btn-elimu-ghost" id="giClose">Cancel</button>
          <button type="button" class="btn-elimu btn-elimu-primary" id="giAck">Acknowledge</button></div>`);
      document.getElementById('giClose').onclick = closeModal;
      document.getElementById('giAck').onclick = async () => {
        const btn = document.getElementById('giAck'); btn.disabled = true; setErr('giErr', null);
        try {
          await api().apiFetch(`/guardian-requests/absences/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH', body: JSON.stringify({ staffNote: document.getElementById('giAckNote').value.trim() }) });
          closeModal(); toast('Notice acknowledged'); await load(); if (onChange) onChange();
        } catch (e) { setErr('giErr', e.message || 'Could not acknowledge.'); btn.disabled = false; }
      };
    }

    load();
    return { reload: load };
  }

  window.ElimuOs = window.ElimuOs || {};
  window.ElimuOs.guardianInbox = { mountEnquiries, mountAbsences, summary };
})();
