(async function () {
  'use strict';
  const { api, esc, $, $$, qs, rupees, stars, avatar, fmtDate, duration, toast, formError } = PF;
  const id = Number(qs('id'));
  const root = $('#profile');
  await PF.ready;

  let p;
  try { p = await api(`/api/pandits/${id}`); } catch (e) {
    root.innerHTML = `<div class="container py-5"><div class="pf-card empty-state"><i class="bi bi-person-x"></i><h4>Profile not available</h4>
      <p>${esc(e.message)}</p><a class="btn btn-primary" href="/search.html">Find another pandit</a></div></div>`;
    return;
  }
  document.title = `${p.name} — Pandit Finder`;
  const me = PF.state.me;
  let selectedService = p.services[0] || null;
  let selected = { date: null, slot: null };

  const verifiedRow = (label, ok, selfText) => `<li class="mb-1">${ok
    ? `<i class="bi bi-patch-check-fill text-success"></i> ${label} <span class="small text-success">verified by Pandit Finder</span>`
    : `<i class="bi bi-person-lines-fill text-muted"></i> ${label} <span class="small text-muted">${selfText || 'self-declared by pandit'}</span>`}</li>`;

  root.innerHTML = `
  <section class="profile-hero"><div class="container"><div class="d-flex flex-column flex-md-row gap-4 align-items-center align-items-md-start text-center text-md-start">
    ${avatar(p.name, p.photo_url, 'avatar-lg')}
    <div class="flex-grow-1">
      <div class="mb-2">${p.identity_verified ? '<span class="badge badge-verified rounded-pill me-1"><i class="bi bi-patch-check-fill"></i> Verified pandit</span>' : ''}
        ${p.is_sample ? '<span class="badge badge-sample rounded-pill">Sample profile — development data</span>' : ''}</div>
      <h1 class="h2 mb-1">${esc(p.name)}</h1>
      <div class="opacity-75 mb-2"><i class="bi bi-geo-alt"></i> ${esc(p.city)}${p.state ? `, ${esc(p.state)}` : ''} · ${p.experience_years} years experience · ${esc(p.languages.join(', '))}</div>
      <div>${stars(p.rating)} ${p.rating != null ? `<strong>${p.rating}</strong> · ${p.review_count} review${p.review_count === 1 ? '' : 's'}` : ''}
        ${p.completed_ceremonies ? ` · ${p.completed_ceremonies} ceremon${p.completed_ceremonies === 1 ? 'y' : 'ies'} completed on Pandit Finder` : ''}</div>
    </div>
    <div class="d-flex flex-column gap-2">
      <a href="#availability" class="btn btn-light text-maroon fw-semibold">Book Now</a>
      ${me?.role === 'customer' ? `<button class="btn btn-outline-light" id="favBtn"><i class="bi ${p.is_favourite ? 'bi-heart-fill' : 'bi-heart'}"></i> ${p.is_favourite ? 'Saved' : 'Save'}</button>` : ''}
    </div>
  </div></div></section>

  <div class="container profile-body"><div class="row g-4">
    <div class="col-lg-7">
      <div class="pf-card p-4 mb-4">
        <h4>About</h4>
        <p style="white-space:pre-line">${esc(p.bio)}</p>
        <div class="row g-3">
          <div class="col-sm-6"><div class="info-label">Specializations</div><div>${p.specializations.map((s) => `<span class="chip">${esc(s.name)}</span>`).join('') || '—'}</div></div>
          <div class="col-sm-6"><div class="info-label">Service areas</div><div>${p.service_areas.map((a) => `<span class="chip">${esc(a)}</span>`).join('') || '—'}${p.offers_online ? '<span class="chip"><i class="bi bi-camera-video"></i> Online pujas</span>' : ''}</div></div>
        </div>
        <hr>
        <div class="info-label mb-2">Verification</div>
        <ul class="list-unstyled small mb-0">
          ${verifiedRow('Identity', p.identity_verified)}
          ${verifiedRow(`Experience (${p.experience_years} years)`, p.experience_verified)}
          ${verifiedRow('Languages, specializations, services and prices', false, 'provided by the pandit')}
        </ul>
        <div class="small text-muted mt-2">Member since ${fmtDate(p.member_since, { month: 'long', year: 'numeric' })}.
          Contact details are shared through the platform after a booking is accepted.</div>
      </div>

      <div class="pf-card p-4 mb-4" id="services">
        <h4>Services & Pricing</h4>
        <p class="small text-muted">Select a service to see matching time slots.</p>
        <div class="d-grid gap-3" id="serviceList">
          ${p.services.length ? p.services.map((s) => `<label class="service-item${s.id === selectedService?.id ? ' selected' : ''}" data-id="${s.id}" style="cursor:pointer">
            <div class="d-flex justify-content-between gap-3">
              <div><input class="form-check-input me-2" type="radio" name="service" value="${s.id}" ${s.id === selectedService?.id ? 'checked' : ''}>
                <strong>${esc(s.name)}</strong> <span class="chip ms-1">${esc(s.category_name)}</span></div>
              <div class="price-tag text-nowrap">${rupees(s.price)}</div></div>
            ${s.description ? `<div class="small text-muted mt-1">${esc(s.description)}</div>` : ''}
            <div class="small mt-2 d-flex flex-wrap gap-3">
              <span><i class="bi bi-clock text-saffron"></i> ${duration(s.duration_minutes)}</span>
              <span><i class="bi bi-basket text-saffron"></i> Samagri ${s.samagri_included ? 'included' : 'not included'}</span>
              <span><i class="bi bi-car-front text-saffron"></i> ${s.travel_charges_apply ? `Travel charge ${rupees(s.travel_charge)}` : 'No travel charge'}</span>
              <span><i class="bi bi-${s.mode === 'online' ? 'camera-video' : s.mode === 'both' ? 'globe' : 'house'} text-saffron"></i> ${{ in_person: 'In person', online: 'Online', both: 'In person or online' }[s.mode]}</span>
            </div>
            ${s.requirements ? `<div class="small mt-1"><i class="bi bi-info-circle text-muted"></i> ${esc(s.requirements)}</div>` : ''}
          </label>`).join('') : '<div class="empty-state">This pandit has not listed any services yet.</div>'}
        </div>
      </div>

      <div class="pf-card p-4 mb-4" id="reviews"><h4>Reviews</h4><div id="reviewBox"><div class="text-muted small">Loading…</div></div></div>
    </div>

    <div class="col-lg-5">
      <div class="pf-card p-4 mb-4" id="availability">
        <h4>Availability</h4>
        <div id="calendar"></div>
        <div class="notice mt-3 small"><i class="bi bi-info-circle"></i> Submitting a booking request does not guarantee the booking. It is confirmed only after the pandit accepts it.</div>
        <div class="d-grid mt-3"><button class="btn btn-primary btn-lg" id="bookBtn" disabled>Select a date & time</button></div>
      </div>
      ${p.approx_location ? `<div class="pf-card p-4 mb-4"><h5>Service region</h5><div id="map" role="img" aria-label="Map of ${esc(p.approx_location.label)}"></div>
        <div class="small text-muted mt-2">${esc(p.approx_location.label)}. Exact addresses are never shown.</div></div>` : ''}
      <div class="text-center small"><button class="btn btn-link btn-sm text-muted" id="reportBtn"><i class="bi bi-flag"></i> Report this profile</button></div>
    </div>
  </div></div>`;

  // Calendar
  const cal = PFCalendar.mount($('#calendar'), {
    panditId: p.id,
    serviceId: selectedService?.id,
    initialDate: qs('date') || p.next_available,
    onSelect(date, slot) {
      selected = { date, slot };
      const b = $('#bookBtn');
      b.disabled = !slot || !selectedService;
      b.textContent = slot ? `Request ${PF.fmtTime(slot.start)} on ${fmtDate(date, { day: 'numeric', month: 'short' })}` : 'Select a date & time';
    },
  });
  $$('#serviceList .service-item').forEach((el) => el.addEventListener('click', () => {
    const sid = Number(el.dataset.id);
    if (selectedService?.id === sid) return;
    selectedService = p.services.find((s) => s.id === sid);
    $$('#serviceList .service-item').forEach((x) => x.classList.toggle('selected', x === el));
    el.querySelector('input').checked = true;
    cal.setService(sid);
  }));
  $('#bookBtn').addEventListener('click', () => {
    const url = `/book.html?pandit=${p.id}&service=${selectedService.id}&date=${selected.date}&time=${selected.slot.start}`;
    if (!me) location.href = `/login.html?next=${encodeURIComponent(url)}`;
    else if (me.role !== 'customer') toast('Please log in with a customer account to book.', 'error');
    else location.href = url;
  });

  // Map: approximate city area only.
  if (p.approx_location && window.L) {
    const map = L.map('map', { scrollWheelZoom: false }).setView([p.approx_location.lat, p.approx_location.lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.circle([p.approx_location.lat, p.approx_location.lng], { radius: 9000, color: '#e8772e', fillColor: '#e8772e', fillOpacity: 0.15 }).addTo(map);
  }

  // Reviews
  async function loadReviews(offset = 0) {
    const data = await api(`/api/pandits/${p.id}/reviews?limit=5&offset=${offset}`);
    const box = $('#reviewBox');
    if (!data.summary.count) { box.innerHTML = '<div class="empty-state py-3"><i class="bi bi-chat-square-heart"></i>No reviews yet. Reviews can only be written by customers after a completed booking.</div>'; return; }
    const dist = [5, 4, 3, 2, 1].map((n) => {
      const pct = Math.round((data.summary.distribution[n] / data.summary.count) * 100);
      return `<div class="d-flex align-items-center gap-2 small"><span style="width:28px">${n}★</span><div class="progress flex-grow-1" style="height:6px"><div class="progress-bar" style="width:${pct}%;background:var(--pf-gold)"></div></div><span class="text-muted" style="width:28px">${data.summary.distribution[n]}</span></div>`;
    }).join('');
    const items = data.reviews.map((r) => `<div class="border-top pt-3 mt-3"><div class="d-flex justify-content-between"><strong>${esc(r.customer_name)}</strong><span class="small text-muted">${fmtDate(r.created_at)}</span></div>
      <div>${stars(r.rating)} <span class="small text-muted">· ${esc(r.ceremony_type)} · Booking ${esc(r.booking_ref)}</span></div>
      ${r.comment ? `<p class="mb-0 mt-1">${esc(r.comment)}</p>` : ''}</div>`).join('');
    if (offset === 0) {
      box.innerHTML = `<div class="row g-3 align-items-center"><div class="col-sm-4 text-center"><div class="display-6 fw-bold text-maroon">${data.summary.average}</div>${stars(data.summary.average)}<div class="small text-muted">${data.summary.count} verified review${data.summary.count === 1 ? '' : 's'}</div></div>
        <div class="col-sm-8">${dist}</div></div><div id="reviewItems">${items}</div>
        ${data.summary.count > 5 ? '<div class="text-center mt-3"><button class="btn btn-sm btn-outline-maroon" id="moreReviews">More reviews</button></div>' : ''}`;
      let off = 5;
      const more = $('#moreReviews');
      if (more) more.addEventListener('click', async () => { const d = await api(`/api/pandits/${p.id}/reviews?limit=5&offset=${off}`); off += 5;
        $('#reviewItems').insertAdjacentHTML('beforeend', d.reviews.map((r) => `<div class="border-top pt-3 mt-3"><strong>${esc(r.customer_name)}</strong> ${stars(r.rating)}<p class="mb-0">${esc(r.comment)}</p></div>`).join(''));
        if (off >= data.summary.count) more.remove(); });
    }
  }
  loadReviews().catch(() => {});

  // Favourite
  const fav = $('#favBtn');
  if (fav) fav.addEventListener('click', async () => {
    try {
      await api(`/api/favourites/${p.id}`, { method: p.is_favourite ? 'DELETE' : 'POST' });
      p.is_favourite = !p.is_favourite;
      fav.innerHTML = `<i class="bi ${p.is_favourite ? 'bi-heart-fill' : 'bi-heart'}"></i> ${p.is_favourite ? 'Saved' : 'Save'}`;
      toast(p.is_favourite ? 'Saved to your favourites' : 'Removed from favourites');
    } catch (e) { toast(e.message, 'error'); }
  });

  // Report
  const modal = new bootstrap.Modal($('#reportModal'));
  $('#reportBtn').addEventListener('click', () => { if (!me) location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; else modal.show(); });
  $('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/complaints', { method: 'POST', body: { kind: 'profile_report', pandit_id: p.id, subject: f.subject.value, details: f.details.value } });
      modal.hide(); f.reset(); toast('Thank you. Our team will review this report.');
    } catch (err) { formError(f, err); }
  });

  if (location.hash === '#availability') setTimeout(() => $('#availability').scrollIntoView({ behavior: 'smooth' }), 200);
})();
