(async function () {
  'use strict';
  const { api, esc, $, qs, rupees, fmtDate, fmtTime, statusBadge, avatar, panditCard, toast, formError, todayStr, fmtDateTime } = PF;
  const me = await PF.requireUser(['customer']).catch(() => null);
  if (!me) return;
  $('#welcome').textContent = `${qs('welcome') ? 'Welcome' : 'Namaste'}, ${me.name.split(' ')[0]}`;

  const all = await api('/api/bookings/my');
  const t = todayStr();
  const groups = {
    upcoming: all.filter((b) => ['accepted', 'confirmed'].includes(b.status) && b.date >= t).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)),
    pending: all.filter((b) => b.status === 'pending'),
    completed: all.filter((b) => b.status === 'completed'),
    closed: all.filter((b) => ['cancelled', 'rejected'].includes(b.status)),
  };
  const stat = (icon, label, n) => `<div class="col-6 col-lg-3"><div class="pf-card stat-card d-flex gap-3 align-items-center"><div class="stat-icon"><i class="bi ${icon}"></i></div><div><div class="stat-value">${n}</div><div class="stat-label">${label}</div></div></div></div>`;
  $('#stats').innerHTML = stat('bi-calendar-check', 'Upcoming', groups.upcoming.length) + stat('bi-hourglass-split', 'Pending', groups.pending.length)
    + stat('bi-stars', 'Completed', groups.completed.length) + stat('bi-x-circle', 'Cancelled', groups.closed.length);

  const empty = {
    upcoming: ['bi-calendar2-heart', 'No upcoming ceremonies', 'Accepted and confirmed bookings appear here.'],
    pending: ['bi-hourglass', 'No pending requests', 'Requests waiting for a pandit to respond appear here.'],
    completed: ['bi-stars', 'No completed ceremonies yet', 'After a ceremony you can leave a review here.'],
    closed: ['bi-archive', 'Nothing here', 'Cancelled and declined bookings appear here.'],
  };
  for (const [key, list] of Object.entries(groups)) {
    const el = document.querySelector(`[data-list=${key}]`);
    el.innerHTML = list.length ? list.map((b) => `<div class="booking-row d-flex flex-wrap gap-3 align-items-center">
        ${avatar(b.pandit_name, b.pandit_photo_url)}
        <div class="flex-grow-1"><div class="fw-semibold">${esc(b.service_name)} <span class="small text-muted">with ${esc(b.pandit_name)}</span></div>
          <div class="small text-muted"><i class="bi bi-calendar"></i> ${fmtDate(b.date)} · ${fmtTime(b.start_time)} · ${esc(b.location_text)}</div>
          <div class="small">${esc(b.booking_ref)} · ${rupees(b.estimated_price)}</div></div>
        <div class="text-end">${statusBadge(b.status, b.status_label)}
          ${b.permissions.confirm ? '<div class="small text-success mt-1">Action needed: confirm</div>' : ''}
          ${b.permissions.review ? '<div class="small text-saffron mt-1">Leave a review</div>' : ''}
          <div class="mt-2"><a class="btn btn-sm btn-outline-maroon" href="/booking.html?id=${b.id}">View details</a></div></div>
      </div>`).join('')
      : `<div class="empty-state"><i class="bi ${empty[key][0]}"></i><h6>${empty[key][1]}</h6><p class="small mb-2">${empty[key][2]}</p><a class="btn btn-sm btn-primary" href="/search.html">Find a pandit</a></div>`;
  }

  // Favourites
  async function loadFavs() {
    const favs = await api('/api/favourites');
    $('#favs').innerHTML = favs.length ? favs.map(panditCard).join('') : '<div class="col-12"><div class="pf-card empty-state"><i class="bi bi-heart"></i>Save pandits from their profile page to find them quickly.</div></div>';
    PF.observeFade();
  }
  loadFavs();

  // Complaints
  $('#cBooking').innerHTML += all.map((b) => `<option value="${b.id}">${esc(b.booking_ref)} — ${esc(b.service_name)} (${fmtDate(b.date)})</option>`).join('');
  async function loadComplaints() {
    const list = await api('/api/complaints/my');
    $('#complaints').innerHTML = list.length ? list.map((c) => `<div class="border-bottom py-2"><div class="d-flex justify-content-between"><strong>${esc(c.subject)}</strong><span class="badge bg-light text-dark text-capitalize">${esc(c.status.replace('_', ' '))}</span></div>
      <div class="text-muted">${fmtDateTime(c.created_at)}</div>${c.admin_note ? `<div class="mt-1"><i class="bi bi-reply"></i> ${esc(c.admin_note)}</div>` : ''}</div>`).join('') : '<div class="text-muted">No complaints submitted.</div>';
  }
  loadComplaints();
  $('#complaintForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/complaints', { method: 'POST', body: { kind: 'complaint', booking_id: f.booking_id.value ? Number(f.booking_id.value) : undefined, subject: f.subject.value, details: f.details.value } });
      f.reset(); toast('Complaint submitted. Our team will respond soon.'); loadComplaints();
    } catch (err) { formError(f, err); }
  });
})();
