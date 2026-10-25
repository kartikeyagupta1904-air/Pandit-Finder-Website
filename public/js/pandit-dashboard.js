(async function () {
  'use strict';
  const { api, esc, $, $$, qs, rupees, fmtDate, fmtTime, statusBadge, avatar, toast, formError, clearFormError, todayStr, duration, stars } = PF;
  const me = await PF.requireUser(['pandit']).catch(() => null);
  if (!me) return;

  const [cats, cities, langs] = await Promise.all([api('/api/categories'), api('/api/cities'), api('/api/languages')]);
  let profile;

  // ---- Overview ----
  async function loadDashboard() {
    const d = await api('/api/pandit/dashboard');
    const banner = {
      pending: `<div class="alert alert-warning"><i class="bi bi-hourglass-split"></i> <strong>Verification pending.</strong> ${qs('applied') ? 'Thank you for applying! ' : ''}Your profile is not visible to customers until an administrator approves it. Meanwhile, complete your profile and availability.</div>`,
      rejected: `<div class="alert alert-danger"><i class="bi bi-x-octagon"></i> <strong>Application not approved.</strong> ${esc(d.rejection_reason || '')} Update your profile and upload new documents (Profile tab) to be reviewed again.</div>`,
      approved: '',
    }[d.verification_status];
    $('#statusBanner').innerHTML = banner;
    const stat = (icon, label, val, sub = '') => `<div class="col-6 col-md-4 col-xl-2"><div class="pf-card stat-card h-100"><div class="stat-icon mb-2"><i class="bi ${icon}"></i></div>
      <div class="stat-value">${val}</div><div class="stat-label">${label}</div>${sub ? `<div class="small text-muted mt-1">${sub}</div>` : ''}</div></div>`;
    const c = d.counts;
    $('#stats').innerHTML = stat('bi-journal-text', 'Total bookings', c.total) + stat('bi-hourglass', 'Pending', c.pending)
      + stat('bi-calendar-event', 'Upcoming', c.upcoming, `${c.accepted} accepted · ${c.confirmed} confirmed`) + stat('bi-stars', 'Completed', c.completed)
      + stat('bi-wallet2', 'Received', rupees(d.earnings.received_total), d.earnings.received_offline_self_reported ? `${rupees(d.earnings.received_offline_self_reported)} self-reported` : 'verified payments')
      + stat('bi-graph-up', 'Completed value', rupees(d.earnings.completed_bookings_estimated_value), 'estimate from bookings');

    $('#pendingList').innerHTML = d.pending.length ? d.pending.map((b) => `<div class="booking-row d-flex flex-wrap gap-2 align-items-center">
      <div class="flex-grow-1"><div class="fw-semibold">${esc(b.service_name)} · ${esc(b.customer_name)}</div>
      <div class="small text-muted">${fmtDate(b.date)} · ${fmtTime(b.start_time)}–${fmtTime(b.end_time)} · ${esc(b.location_text)}</div><div class="small">${rupees(b.estimated_price)} · ${esc(b.booking_ref)}</div></div>
      <div class="d-flex gap-2">${b.permissions.accept ? `<button class="btn btn-sm btn-primary" data-accept="${b.id}">Accept</button>` : ''}<a class="btn btn-sm btn-outline-maroon" href="/booking.html?id=${b.id}">Details</a></div></div>`).join('')
      : '<div class="empty-state"><i class="bi bi-inbox"></i>No pending requests right now.</div>';
    $$('[data-accept]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await api(`/api/bookings/${btn.dataset.accept}/status`, { method: 'PATCH', body: { status: 'accepted' } }); toast('Booking accepted.'); loadDashboard(); loadHistory(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    $('#upcomingList').innerHTML = d.upcoming.length ? d.upcoming.map((b) => `<a class="booking-row d-block text-decoration-none text-reset" href="/booking.html?id=${b.id}">
      <div class="d-flex justify-content-between"><strong>${fmtDate(b.date, { day: 'numeric', month: 'short' })} · ${fmtTime(b.start_time)}</strong>${statusBadge(b.status, b.status_label)}</div>
      <div class="small text-muted">${esc(b.service_name)} · ${esc(b.customer_name)}</div></a>`).join('')
      : '<div class="empty-state py-4"><i class="bi bi-calendar"></i>No upcoming ceremonies.</div>';
    $('#completion').innerHTML = `<div class="progress mb-2" style="height:8px"><div class="progress-bar" style="width:${d.completion.percent}%;background:var(--pf-saffron)"></div></div>
      <div class="small mb-2">${d.completion.percent}% complete</div>
      <ul class="list-unstyled small mb-0">${d.completion.items.map((i) => `<li><i class="bi ${i.ok ? 'bi-check-circle-fill text-success' : 'bi-circle text-muted'}"></i> ${esc(i.label)}</li>`).join('')}</ul>`;
    if (d.verification_status === 'approved') { $('#viewProfile').classList.remove('d-none'); }
  }

  // ---- History ----
  async function loadHistory() {
    const status = $('#histFilter').value;
    const list = await api(`/api/bookings/my${status ? `?status=${status}` : ''}`);
    $('#histBody').innerHTML = list.length ? list.map((b) => `<tr><td class="small">${esc(b.booking_ref)}</td><td class="small">${fmtDate(b.date, { day: 'numeric', month: 'short', year: 'numeric' })}<br>${fmtTime(b.start_time)}</td>
      <td>${esc(b.customer_name)}</td><td class="small">${esc(b.service_name)}</td><td>${rupees(b.estimated_price)}</td><td>${statusBadge(b.status, b.status_label)}</td>
      <td><a class="btn btn-sm btn-outline-maroon" href="/booking.html?id=${b.id}">Open</a></td></tr>`).join('')
      : '<tr><td colspan="7" class="text-center text-muted py-4">No bookings found.</td></tr>';
  }
  $('#histFilter').addEventListener('change', loadHistory);

  // ---- Services ----
  const sf = $('#serviceForm');
  $('#sCat').innerHTML = cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('#sDur').innerHTML = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => `<option value="${m}">${duration(m)}</option>`).join('');
  $('#sDur').value = '120';
  let services = [];
  async function loadServices() {
    services = await api('/api/pandit/services');
    $('#serviceList').innerHTML = services.length ? services.map((s) => `<div class="booking-row d-flex flex-wrap gap-2 align-items-center ${s.is_active ? '' : 'opacity-50'}">
      <div class="flex-grow-1"><div class="fw-semibold">${esc(s.name)} ${s.is_active ? '' : '<span class="badge bg-secondary">Inactive</span>'}</div>
      <div class="small text-muted">${esc(s.category_name)} · ${duration(s.duration_minutes)} · ${{ in_person: 'In person', online: 'Online', both: 'Both' }[s.mode]} · Samagri ${s.samagri_included ? 'included' : 'not included'}${s.travel_charges_apply ? ` · Travel ${rupees(s.travel_charge)}` : ''}</div></div>
      <div class="price-tag me-2">${rupees(s.price)}</div>
      <button class="btn btn-sm btn-outline-maroon" data-edit="${s.id}">Edit</button><button class="btn btn-sm btn-outline-danger" data-del="${s.id}" aria-label="Delete ${esc(s.name)}"><i class="bi bi-trash"></i></button></div>`).join('')
      : '<div class="empty-state"><i class="bi bi-list-check"></i>Add at least one service so customers can book you.</div>';
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editService(services.find((s) => s.id === Number(b.dataset.edit)))));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this service? Services with booking history will be archived instead.')) return;
      try { const r = await api(`/api/pandit/services/${b.dataset.del}`, { method: 'DELETE' }); toast(r.archived ? 'Service archived (it has booking history).' : 'Service deleted.'); loadServices(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  function editService(s) {
    sf.id.value = s ? s.id : '';
    sf.category_id.value = s ? s.category_id : cats[0]?.id;
    sf.name.value = s?.name || ''; sf.description.value = s?.description || ''; sf.price.value = s?.price ?? '';
    sf.duration_minutes.value = s?.duration_minutes || 120; sf.mode.value = s?.mode || 'in_person';
    sf.travel_charge.value = s?.travel_charges_apply ? s.travel_charge : ''; sf.samagri_included.checked = !!s?.samagri_included;
    sf.is_active.checked = s ? s.is_active : true; sf.requirements.value = s?.requirements || '';
    $('#svcFormTitle').textContent = s ? 'Edit service' : 'Add a service';
    $('#svcCancel').classList.toggle('d-none', !s);
    if (s) sf.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#svcCancel').addEventListener('click', () => editService(null));
  sf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(sf);
    const travel = Number(sf.travel_charge.value || 0);
    const body = { category_id: Number(sf.category_id.value), name: sf.name.value, description: sf.description.value, price: sf.price.value === '' ? undefined : Number(sf.price.value),
      duration_minutes: Number(sf.duration_minutes.value), mode: sf.mode.value, travel_charges_apply: travel > 0, travel_charge: travel,
      samagri_included: sf.samagri_included.checked, is_active: sf.is_active.checked, requirements: sf.requirements.value };
    try {
      if (sf.id.value) await api(`/api/pandit/services/${sf.id.value}`, { method: 'PUT', body });
      else await api('/api/pandit/services', { method: 'POST', body });
      toast('Service saved.'); editService(null); loadServices(); loadDashboard();
    } catch (err) { formError(sf, err); }
  });

  // ---- Availability ----
  const af = $('#availForm');
  $('#availDays').innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<input type="checkbox" class="btn-check" id="ad${i}" value="${i}" ${i ? 'checked' : ''}><label class="btn btn-sm btn-outline-saffron" for="ad${i}">${d}</label>`).join('');
  $('#avDate').min = todayStr(); $('#blDate').min = todayStr();
  af.addEventListener('change', () => {
    const date = af.querySelector('[name=kind]:checked').value === 'date';
    $('#weeklyFields').classList.toggle('d-none', date); $('#dateFields').classList.toggle('d-none', !date);
  });
  af.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(af);
    const isDate = af.querySelector('[name=kind]:checked').value === 'date';
    const body = { start_time: af.start_time.value, end_time: af.end_time.value };
    if (isDate) body.date = af.date.value; else { body.weekdays = $$('#availDays input:checked').map((x) => Number(x.value)); body.weeks = Number(af.weeks.value); }
    try { const r = await api('/api/pandit/availability', { method: 'POST', body }); toast(r.message, r.created ? 'success' : 'info'); loadAvailability(); loadDashboard(); }
    catch (err) { formError(af, err); }
  });
  const bf = $('#blockForm');
  bf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(bf);
    try { await api('/api/pandit/blocked-dates', { method: 'POST', body: { date: bf.date.value, reason: bf.reason.value } }); bf.reset(); toast('Date blocked.'); loadAvailability(); }
    catch (err) { formError(bf, err); }
  });
  async function loadAvailability() {
    const a = await api('/api/pandit/availability');
    const byDate = {};
    a.slots.forEach((s) => { (byDate[s.date] ||= { slots: [], bookings: [] }).slots.push(s); });
    a.bookings.forEach((b) => { (byDate[b.date] ||= { slots: [], bookings: [] }).bookings.push(b); });
    a.blocked.forEach((b) => { (byDate[b.date] ||= { slots: [], bookings: [] }).blocked = b; });
    const dates = Object.keys(byDate).sort();
    $('#availList').innerHTML = dates.length ? dates.map((d) => {
      const x = byDate[d];
      return `<div class="border-bottom py-2"><div class="d-flex justify-content-between align-items-center"><strong class="small">${fmtDate(d)}</strong>
        ${x.blocked ? `<span><span class="badge bg-danger-subtle text-danger">Blocked${x.blocked.reason ? `: ${esc(x.blocked.reason)}` : ''}</span> <button class="btn btn-link btn-sm p-0 ms-1" data-unblock="${x.blocked.id}">Unblock</button></span>` : ''}</div>
        <div class="mt-1">${x.slots.map((s) => `<span class="chip">${fmtTime(s.start)}–${fmtTime(s.end)} <button class="btn btn-link btn-sm p-0 text-danger ms-1" data-delslot="${s.id}" aria-label="Remove window"><i class="bi bi-x"></i></button></span>`).join('')}
        ${x.bookings.map((b) => `<a class="chip text-decoration-none" href="/booking.html?id=${b.id}" style="background:#fff4e0"><i class="bi bi-bookmark-check"></i> ${fmtTime(b.start)} ${esc(b.status)}</a>`).join('')}</div></div>`;
    }).join('') : '<div class="empty-state"><i class="bi bi-calendar-plus"></i>No availability published. Customers can only book times you publish here.</div>';
    $$('[data-delslot]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/pandit/availability/${b.dataset.delslot}`, { method: 'DELETE' }); loadAvailability(); } catch (e) { toast(e.message, 'error'); }
    }));
    $$('[data-unblock]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/pandit/blocked-dates/${b.dataset.unblock}`, { method: 'DELETE' }); loadAvailability(); } catch (e) { toast(e.message, 'error'); }
    }));
  }

  // ---- Profile ----
  const pf = $('#profileForm');
  $('#pCity').innerHTML = cities.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const box = (name, value, label) => `<input type="checkbox" class="btn-check" name="${name}" id="p-${name}-${esc(value)}" value="${esc(value)}"><label class="btn btn-sm btn-outline-saffron" for="p-${name}-${esc(value)}">${esc(label)}</label>`;
  $('#pLangs').innerHTML = langs.map((l) => box('languages', l, l)).join('');
  $('#pSpecs').innerHTML = cats.map((c) => box('specializations', c.id, c.name)).join('');
  async function loadProfile() {
    profile = await api('/api/pandit/me');
    $('#pdName').textContent = `Namaste, ${profile.name}`;
    $('#viewProfile').href = `/pandit.html?id=${profile.id}`;
    pf.name.value = profile.name; pf.phone.value = profile.phone || ''; pf.city_id.value = profile.city?.id;
    pf.experience_years.value = profile.experience_years; pf.service_areas.value = profile.service_areas.join(', ');
    pf.bio.value = profile.bio; pf.preferred_contact.value = profile.preferred_contact; pf.offers_online.checked = profile.offers_online;
    $$('[name=languages]', pf).forEach((x) => { x.checked = profile.languages.some((l) => l.toLowerCase() === x.value.toLowerCase()); });
    $$('[name=specializations]', pf).forEach((x) => { x.checked = profile.specializations.includes(Number(x.value)); });
    $('#photoBox').innerHTML = avatar(profile.name, profile.photo_url, 'avatar-lg');
    $('#removePhoto').classList.toggle('d-none', !profile.photo_url);
    $('#docList').innerHTML = profile.documents.length ? profile.documents.map((d) => `<div><i class="bi bi-file-earmark-lock"></i> ${esc(d.doc_type)} · ${esc(d.original_name)} ${d.purged_at ? '<span class="text-muted">(deleted after review)</span>' : ''}</div>`).join('') : '<div class="text-muted">No documents.</div>';
  }
  pf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(pf);
    const body = { name: pf.name.value, phone: pf.phone.value, city_id: Number(pf.city_id.value), experience_years: Number(pf.experience_years.value),
      service_areas: pf.service_areas.value.split(',').map((s) => s.trim()).filter(Boolean), bio: pf.bio.value, preferred_contact: pf.preferred_contact.value,
      offers_online: pf.offers_online.checked, languages: $$('[name=languages]:checked', pf).map((x) => x.value), specializations: $$('[name=specializations]:checked', pf).map((x) => Number(x.value)) };
    try { await api('/api/pandit/profile', { method: 'PUT', body }); toast('Profile saved.'); loadProfile(); loadDashboard(); } catch (err) { formError(pf, err); }
  });
  $('#photoForm').photo.addEventListener('change', async (e) => {
    const fd = new FormData(); fd.append('photo', e.target.files[0]);
    try { await api('/api/pandit/photo', { method: 'POST', form: fd }); toast('Photo updated.'); loadProfile(); } catch (err) { toast(err.message, 'error'); }
    e.target.value = '';
  });
  $('#removePhoto').addEventListener('click', async () => { if (!confirm('Remove your profile photo?')) return; await api('/api/pandit/photo', { method: 'DELETE' }); loadProfile(); });
  $('#docForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.document.files[0]) return toast('Choose a document first.', 'error');
    const fd = new FormData(); fd.append('doc_type', f.doc_type.value); fd.append('document', f.document.files[0]);
    try { await api('/api/pandit/documents', { method: 'POST', form: fd }); f.reset(); toast('Document uploaded securely.'); loadProfile(); loadDashboard(); } catch (err) { toast(err.message, 'error'); }
  });

  // ---- Reviews ----
  async function loadReviews() {
    const list = await api('/api/pandit/reviews');
    $('#reviewList').innerHTML = list.length ? list.map((r) => `<div class="booking-row"><div class="d-flex justify-content-between"><strong>${esc(r.customer_name)}</strong><span class="small text-muted">${fmtDate(r.created_at)}</span></div>
      <div>${stars(r.rating)} <span class="small text-muted">${esc(r.ceremony_type)} · ${esc(r.booking_ref)}${r.status === 'hidden' ? ' · hidden by moderator' : ''}</span></div><p class="mb-0">${esc(r.comment)}</p></div>`).join('')
      : '<div class="empty-state"><i class="bi bi-chat-heart"></i>Reviews from customers after completed ceremonies will appear here.</div>';
  }

  await Promise.all([loadProfile(), loadDashboard(), loadHistory(), loadServices(), loadAvailability(), loadReviews()]);
  if (location.hash === '#reviews') $('#reviewsTab').click();
})();
