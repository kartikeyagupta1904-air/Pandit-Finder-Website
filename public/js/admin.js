(async function () {
  'use strict';
  const { api, esc, $, $$, rupees, fmtDate, fmtTime, fmtDateTime, statusBadge, toast, formError, clearFormError, avatar } = PF;
  const me = await PF.requireUser(['admin']).catch(() => null);
  if (!me) return;
  const appModal = new bootstrap.Modal($('#appModal'));
  const deb = (fn, ms = 350) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  // ---- Overview ----
  let charts = [];
  async function loadOverview() {
    const d = await api('/api/admin/dashboard');
    $('#pvBadge').textContent = d.pending_verifications || '';
    const stat = (icon, label, val) => `<div class="col-6 col-md-4 col-xl-2"><div class="pf-card stat-card h-100"><div class="stat-icon mb-2"><i class="bi ${icon}"></i></div><div class="stat-value">${val}</div><div class="stat-label">${label}</div></div></div>`;
    $('#adminStats').innerHTML = [
      stat('bi-people', 'Customers', d.customers), stat('bi-person-badge', 'Pandits', d.pandits), stat('bi-hourglass-split', 'Pending verification', d.pending_verifications),
      stat('bi-patch-check', 'Approved', d.approved_pandits), stat('bi-x-octagon', 'Rejected', d.rejected_applications), stat('bi-flag', 'Open complaints', d.open_complaints),
      stat('bi-journal-text', 'Total bookings', d.bookings.total), stat('bi-check2-all', 'Confirmed', d.bookings.confirmed), stat('bi-stars', 'Completed', d.bookings.completed),
      stat('bi-x-circle', 'Cancelled', d.bookings.cancelled), stat('bi-chat-square-text', 'Reviews', d.reviews), stat('bi-person-slash', 'Suspended', d.suspended_users),
    ].join('');
    charts.forEach((c) => c.destroy());
    charts = [
      new Chart($('#chartDaily'), { type: 'bar', data: { labels: d.bookings_last_30_days.map((x) => fmtDate(x.date, { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'Booking requests', data: d.bookings_last_30_days.map((x) => x.bookings), backgroundColor: '#e8772e', borderRadius: 4 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }),
      new Chart($('#chartStatus'), { type: 'doughnut', data: { labels: ['Pending', 'Accepted', 'Confirmed', 'Completed', 'Rejected', 'Cancelled'],
        datasets: [{ data: [d.bookings.pending, d.bookings.accepted, d.bookings.confirmed, d.bookings.completed, d.bookings.rejected, d.bookings.cancelled],
          backgroundColor: ['#f0b441', '#4a7bd0', '#2f9e5b', '#6b4fbb', '#c44d4d', '#9a8f88'] }] }, options: { plugins: { legend: { position: 'bottom' } } } }),
    ];
    $('#activity').innerHTML = d.recent_activity.length ? d.recent_activity.map((a) => `<div class="border-bottom py-1"><strong>${esc(a.actor_name || 'system')}</strong> · ${esc(a.action)} ${a.entity_type ? `(${esc(a.entity_type)} #${a.entity_id ?? ''})` : ''} <span class="text-muted">${fmtDateTime(a.created_at)}</span></div>`).join('') : '<span class="text-muted">No activity yet.</span>';
  }

  // ---- Verifications ----
  async function loadVerifications() {
    const list = await api(`/api/admin/verifications?status=${$('#vStatus').value}`);
    $('#vBody').innerHTML = list.length ? list.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${p.is_sample ? ' <span class="badge badge-sample">sample</span>' : ''}<div class="small text-muted">${esc(p.email)}</div></td>
      <td>${esc(p.city)}</td><td>${p.experience_years} yrs</td><td>${p.document_count}</td><td class="small">${fmtDateTime(p.created_at)}</td>
      <td><span class="badge bg-light text-dark text-capitalize">${esc(p.verification_status)}</span></td><td><button class="btn btn-sm btn-primary" data-review="${p.id}">Review</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="text-center text-muted py-4">No applications in this list.</td></tr>';
    $$('[data-review]').forEach((b) => b.addEventListener('click', () => openApplication(Number(b.dataset.review))));
  }
  $('#vStatus').addEventListener('change', loadVerifications);

  async function openApplication(id) {
    const a = await api(`/api/admin/verifications/${id}`);
    $('#appTitle').textContent = `Application — ${a.name}`;
    $('#appBody').innerHTML = `<div class="d-flex gap-3 mb-3">${avatar(a.name, a.photo_url, 'avatar-lg')}<div>
        <div><strong>${esc(a.name)}</strong> · <span class="text-capitalize">${esc(a.verification_status)}</span></div>
        <div class="small">${esc(a.email)} · ${esc(a.phone || '')}</div><div class="small">${esc(a.city)} · ${a.experience_years} years · contact: ${esc(a.preferred_contact)}</div>
        <div class="small text-muted">Applied ${fmtDateTime(a.created_at)}</div></div></div>
      <div class="mb-2"><div class="info-label">Biography</div><div class="small" style="white-space:pre-line">${esc(a.bio)}</div></div>
      <div class="row g-2 small mb-2"><div class="col-md-4"><div class="info-label">Languages</div>${esc(a.languages.join(', '))}</div>
        <div class="col-md-4"><div class="info-label">Specializations</div>${esc(a.specializations.join(', '))}</div><div class="col-md-4"><div class="info-label">Areas</div>${esc(a.service_areas.join(', '))}</div></div>
      <div class="info-label">Services</div><ul class="small">${a.services.map((s) => `<li>${esc(s.name)} — ${rupees(s.price)}, ${PF.duration(s.duration_minutes)}, ${esc(s.mode)}</li>`).join('')}</ul>
      <div class="info-label">Private documents</div>${a.documents.length ? a.documents.map((d) => `<div class="small">${d.purged_at ? `<i class="bi bi-trash"></i> ${esc(d.doc_type)} — purged ${fmtDateTime(d.purged_at)}`
        : `<a href="/api/admin/documents/${d.id}" target="_blank" rel="noopener"><i class="bi bi-file-earmark-lock"></i> ${esc(d.doc_type)} · ${esc(d.original_name)}</a> <span class="text-muted">(${Math.round(d.size_bytes / 1024)} KB)</span>`}</div>`).join('') : '<div class="small text-muted">No documents.</div>'}
      ${a.rejection_reason ? `<div class="alert alert-light border small mt-2">Previous rejection: ${esc(a.rejection_reason)}</div>` : ''}`;
    $('#appFooter').innerHTML = `<form id="decisionForm" novalidate><div class="form-alert d-none"></div>
      <div class="d-flex flex-wrap gap-3 mb-2"><div class="form-check"><input class="form-check-input" type="checkbox" id="dId" name="identity_verified" checked><label class="form-check-label small" for="dId">Identity verified from documents</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="dExp" name="experience_verified" ${a.experience_verified ? 'checked' : ''}><label class="form-check-label small" for="dExp">Experience verified (certificate/reference)</label></div></div>
      <label class="form-label small" for="dReason">Reason (required to reject; sent to the applicant)</label><textarea class="form-control form-control-sm mb-2" id="dReason" name="reason" rows="2"></textarea>
      <div class="d-flex gap-2 justify-content-end"><button type="button" class="btn btn-outline-danger" data-decision="reject">Reject</button><button type="button" class="btn btn-primary" data-decision="approve">Approve & verify</button></div></form>`;
    $$('[data-decision]').forEach((b) => b.addEventListener('click', async () => {
      const f = $('#decisionForm');
      clearFormError(f);
      try {
        await api(`/api/admin/verifications/${id}`, { method: 'PATCH', body: { decision: b.dataset.decision, reason: f.reason.value, identity_verified: f.identity_verified.checked, experience_verified: f.experience_verified.checked } });
        appModal.hide(); toast(`Application ${b.dataset.decision === 'approve' ? 'approved' : 'rejected'}.`); loadVerifications(); loadOverview();
      } catch (err) { formError(f, err); }
    }));
    appModal.show();
  }

  // ---- Users ----
  async function loadUsers() {
    const list = await api(`/api/admin/users?role=${$('#uRole').value}&q=${encodeURIComponent($('#uQ').value)}`);
    $('#uBody').innerHTML = list.map((u) => `<tr><td>${esc(u.name)}${u.pandit_id ? ` <span class="small text-muted">(${esc(u.verification_status)})</span>` : ''}</td><td class="small">${esc(u.email)}</td>
      <td class="text-capitalize">${esc(u.role)}</td><td>${u.status === 'active' ? '<span class="badge bg-success-subtle text-success">Active</span>' : '<span class="badge bg-danger-subtle text-danger">Suspended</span>'}</td>
      <td class="small">${fmtDate(u.created_at)}</td><td>${u.id === me.id ? '<span class="small text-muted">You</span>' : `<button class="btn btn-sm ${u.status === 'active' ? 'btn-outline-danger' : 'btn-outline-success'}" data-user="${u.id}" data-to="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`}</td></tr>`).join('')
      || '<tr><td colspan="6" class="text-center text-muted py-4">No users found.</td></tr>';
    $$('[data-user]').forEach((b) => b.addEventListener('click', async () => {
      const reason = b.dataset.to === 'suspended' ? prompt('Reason for suspension (recorded in audit log):') : '';
      if (reason === null) return;
      try { await api(`/api/admin/users/${b.dataset.user}/status`, { method: 'PATCH', body: { status: b.dataset.to, reason } }); toast('Account updated.'); loadUsers(); } catch (e) { toast(e.message, 'error'); }
    }));
  }
  $('#uRole').addEventListener('change', loadUsers); $('#uQ').addEventListener('input', deb(loadUsers));

  // ---- Bookings ----
  async function loadBookings() {
    const list = await api(`/api/admin/bookings?status=${$('#bStatus').value}&q=${encodeURIComponent($('#bQ').value)}`);
    $('#bBody').innerHTML = list.map((b) => `<tr><td class="small">${esc(b.booking_ref)}<br><span class="text-muted">${esc(b.ceremony_type)}</span></td><td class="small">${fmtDate(b.date)}<br>${fmtTime(b.start_time)}</td>
      <td>${esc(b.customer_name)}</td><td>${esc(b.pandit_name)}</td><td>${rupees(b.estimated_price)}</td><td>${statusBadge(b.status, b.status_label)}</td>
      <td><a class="btn btn-sm btn-outline-maroon" href="/booking.html?id=${b.id}">Manage</a></td></tr>`).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">No bookings.</td></tr>';
  }
  $('#bStatus').addEventListener('change', loadBookings); $('#bQ').addEventListener('input', deb(loadBookings));

  // ---- Categories ----
  const cf = $('#catForm');
  let cats = [];
  async function loadCategories() {
    cats = await api('/api/admin/categories');
    $('#cBody').innerHTML = cats.map((c) => `<tr><td><i class="bi ${esc(c.icon)} text-saffron"></i> <strong>${esc(c.name)}</strong><div class="small text-muted">${esc(c.description)}</div></td>
      <td>${c.service_count}</td><td>${c.sort_order}</td><td>${c.is_active ? 'Active' : '<span class="text-muted">Inactive</span>'}</td>
      <td class="text-nowrap"><button class="btn btn-sm btn-outline-maroon" data-cedit="${c.id}">Edit</button> <button class="btn btn-sm btn-outline-danger" data-cdel="${c.id}" aria-label="Delete"><i class="bi bi-trash"></i></button></td></tr>`).join('');
    $$('[data-cedit]').forEach((b) => b.addEventListener('click', () => editCat(cats.find((c) => c.id === Number(b.dataset.cedit)))));
    $$('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this category? Categories in use are deactivated instead.')) return;
      try { const r = await api(`/api/admin/categories/${b.dataset.cdel}`, { method: 'DELETE' }); toast(r.deactivated ? 'Category in use — deactivated.' : 'Category deleted.'); loadCategories(); } catch (e) { toast(e.message, 'error'); }
    }));
  }
  function editCat(c) {
    cf.id.value = c ? c.id : ''; cf.name.value = c?.name || ''; cf.description.value = c?.description || ''; cf.icon.value = c?.icon || 'bi-flower1';
    cf.sort_order.value = c?.sort_order ?? 100; cf.is_active.checked = c ? !!c.is_active : true;
    $('#catTitle').textContent = c ? 'Edit category' : 'Add category'; $('#catCancel').classList.toggle('d-none', !c);
  }
  $('#catCancel').addEventListener('click', () => editCat(null));
  cf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(cf);
    const body = { name: cf.name.value, description: cf.description.value, icon: cf.icon.value, sort_order: Number(cf.sort_order.value), is_active: cf.is_active.checked };
    try { await api(cf.id.value ? `/api/admin/categories/${cf.id.value}` : '/api/admin/categories', { method: cf.id.value ? 'PUT' : 'POST', body }); toast('Category saved.'); editCat(null); loadCategories(); }
    catch (err) { formError(cf, err); }
  });

  // ---- Complaints ----
  async function loadComplaints() {
    const list = await api(`/api/admin/complaints?kind=${$('#coKind').value}&status=${$('#coStatus').value}`);
    $('#coList').innerHTML = list.length ? list.map((c) => `<div class="booking-row"><div class="d-flex flex-wrap justify-content-between gap-2">
      <div><span class="badge ${c.kind === 'profile_report' ? 'bg-danger-subtle text-danger' : 'bg-warning-subtle text-dark'}">${c.kind === 'profile_report' ? 'Profile report' : 'Complaint'}</span> <strong>${esc(c.subject)}</strong>
        <div class="small text-muted">by ${esc(c.reporter_name)} (${esc(c.reporter_email)}) · ${fmtDateTime(c.created_at)}${c.pandit_name ? ` · about <a href="/pandit.html?id=${c.pandit_id}">${esc(c.pandit_name)}</a>` : ''}${c.booking_ref ? ` · <a href="/booking.html?id=${c.booking_id}">${esc(c.booking_ref)}</a>` : ''}</div></div>
      <div class="d-flex gap-2 align-items-start"><select class="form-select form-select-sm w-auto" data-co="${c.id}" aria-label="Status">${['open', 'in_review', 'resolved', 'dismissed'].map((s) => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></div></div>
      <p class="small mb-1 mt-2" style="white-space:pre-line">${esc(c.details)}</p>
      <div class="input-group input-group-sm"><input class="form-control" placeholder="Note to reporter" value="${esc(c.admin_note || '')}" data-note="${c.id}" aria-label="Admin note"><button class="btn btn-outline-maroon" data-save="${c.id}">Update</button></div></div>`).join('')
      : '<div class="empty-state"><i class="bi bi-flag"></i>No reports or complaints.</div>';
    $$('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.save;
      try { await api(`/api/admin/complaints/${id}`, { method: 'PATCH', body: { status: $(`[data-co="${id}"]`).value, admin_note: $(`[data-note="${id}"]`).value } }); toast('Updated and reporter notified.'); loadComplaints(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  $('#coKind').addEventListener('change', loadComplaints); $('#coStatus').addEventListener('change', loadComplaints);

  // ---- Reviews ----
  async function loadReviews() {
    const list = await api('/api/admin/reviews');
    $('#rvList').innerHTML = list.length ? list.map((r) => `<div class="booking-row d-flex flex-wrap gap-2 justify-content-between ${r.status === 'hidden' ? 'opacity-50' : ''}">
      <div><div>${PF.stars(r.rating)} <strong>${esc(r.customer_name)}</strong> → ${esc(r.pandit_name)} <span class="small text-muted">${esc(r.booking_ref)} · ${fmtDate(r.created_at)}</span></div>
      <div class="small">${esc(r.comment)}</div>${r.moderation_note ? `<div class="small text-muted">Moderation: ${esc(r.moderation_note)}</div>` : ''}</div>
      <div><button class="btn btn-sm ${r.status === 'visible' ? 'btn-outline-danger' : 'btn-outline-success'}" data-rv="${r.id}" data-to="${r.status === 'visible' ? 'hidden' : 'visible'}">${r.status === 'visible' ? 'Hide' : 'Restore'}</button></div></div>`).join('')
      : '<div class="empty-state"><i class="bi bi-chat-square-text"></i>No reviews yet.</div>';
    $$('[data-rv]').forEach((b) => b.addEventListener('click', async () => {
      const note = b.dataset.to === 'hidden' ? prompt('Moderation note (internal):', '') : '';
      if (note === null) return;
      try { await api(`/api/admin/reviews/${b.dataset.rv}`, { method: 'PATCH', body: { status: b.dataset.to, moderation_note: note } }); loadReviews(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ---- Audit ----
  let auditPage = 1;
  async function loadAudit() {
    const list = await api(`/api/admin/audit-logs?page=${auditPage}`);
    $('#aBody').innerHTML = list.map((a) => `<tr><td class="text-nowrap">${fmtDateTime(a.created_at)}</td><td>${esc(a.actor_name || 'system')}</td><td><code>${esc(a.action)}</code></td>
      <td>${esc(a.entity_type || '')} ${a.entity_id ?? ''}</td><td class="text-break" style="max-width:280px">${esc(a.details)}</td><td>${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted py-3">No entries.</td></tr>';
    $('#aPrev').disabled = auditPage === 1; $('#aNext').disabled = list.length < 50;
  }
  $('#aPrev').addEventListener('click', () => { auditPage--; loadAudit(); });
  $('#aNext').addEventListener('click', () => { auditPage++; loadAudit(); });

  // ---- Settings ----
  const sf = $('#setForm');
  async function loadSettings() {
    const [s, pub] = await Promise.all([api('/api/admin/settings'), api('/api/settings/public')]);
    for (const k of ['cancellation_hours', 'min_lead_hours', 'max_advance_days', 'document_retention_days', 'support_email', 'support_phone']) sf.elements[k].value = s[k];
    sf.allow_new_pandit_applications.checked = s.allow_new_pandit_applications === '1';
    $('#integrations').innerHTML = `<div class="notice"><strong>Integrations</strong> (configured through environment variables, see README):<br>
      Online payments (Razorpay): ${pub.online_payments ? '<span class="text-success">configured</span>' : '<span class="text-muted">not configured — pay-later workflow active</span>'}<br>
      Email notifications (SMTP): ${pub.email_notifications ? '<span class="text-success">configured</span>' : '<span class="text-muted">not configured — in-app notifications only</span>'}</div>`;
  }
  sf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(sf);
    const body = {};
    for (const k of ['cancellation_hours', 'min_lead_hours', 'max_advance_days', 'document_retention_days']) body[k] = Number(sf.elements[k].value);
    body.support_email = sf.support_email.value; body.support_phone = sf.support_phone.value; body.allow_new_pandit_applications = sf.allow_new_pandit_applications.checked;
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Settings saved.'); } catch (err) { formError(sf, err); }
  });

  await Promise.all([loadOverview(), loadVerifications(), loadUsers(), loadBookings(), loadCategories(), loadComplaints(), loadReviews(), loadAudit(), loadSettings()]);
  if (location.hash) { const btn = $(`[data-bs-target="${location.hash}"]`); if (btn) btn.click(); }
})();
