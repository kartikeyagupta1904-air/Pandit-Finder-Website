(async function () {
  'use strict';
  const { api, esc, $, qs, rupees, avatar, fmtDate, fmtTime, duration, formError, clearFormError, withBusy } = PF;
  await PF.requireUser(['customer']).catch(() => null);
  if (!PF.state.me) return;
  const root = $('#bookRoot');

  let p;
  try { p = await api(`/api/pandits/${Number(qs('pandit'))}`); } catch (e) {
    root.innerHTML = `<div class="pf-card empty-state"><i class="bi bi-exclamation-circle"></i><p>${esc(e.message)}</p><a href="/search.html" class="btn btn-primary">Find a pandit</a></div>`;
    return;
  }
  const service = p.services.find((s) => s.id === Number(qs('service'))) || p.services[0];
  if (!service) { root.innerHTML = '<div class="pf-card empty-state">This pandit has no bookable services.</div>'; return; }
  let date = qs('date');
  let start = qs('time');
  let slotEnd = null;
  const profile = PF.state.meFull?.profile || {};

  root.innerHTML = `<div class="row g-4">
    <div class="col-lg-7"><form class="pf-card p-4" id="bookForm" novalidate>
      <div class="form-alert d-none"></div>
      <h5 class="mb-3">1. Date & time</h5>
      <div id="slotSummary" class="mb-2"></div>
      <button type="button" class="btn btn-sm btn-outline-maroon mb-3" id="changeSlot">Change date or time</button>
      <div id="calWrap" class="d-none mb-3"></div>
      <h5 class="mb-3 mt-2">2. Ceremony details</h5>
      ${service.mode === 'both' ? `<div class="mb-3"><label class="form-label">How should the puja be performed?</label>
        <div class="d-flex gap-3"><div class="form-check"><input class="form-check-input" type="radio" name="service_mode" id="mIn" value="in_person" checked><label class="form-check-label" for="mIn">In person</label></div>
        <div class="form-check"><input class="form-check-input" type="radio" name="service_mode" id="mOn" value="online"><label class="form-check-label" for="mOn">Online (video call)</label></div></div></div>` : ''}
      <div class="mb-3"><label class="form-label" for="loc" id="locLabel">Ceremony location (locality, city)</label>
        <input class="form-control" id="loc" name="location_text" required minlength="3" maxlength="300" placeholder="e.g. Sector 12, Dwarka, ${esc(p.city)}" value="${service.mode === 'online' ? 'Online' : esc(profile.city || '')}">
        <div class="form-text">Share your full address with the pandit in booking messages after the request is accepted.</div></div>
      <div class="mb-3"><label class="form-label" for="samagri">Samagri requirements</label>
        <textarea class="form-control" id="samagri" name="samagri_requirements" rows="2" maxlength="1000" placeholder="${service.samagri_included ? 'Samagri is included. Mention any special items.' : 'Would you like the pandit to arrange samagri? Any items you already have?'}"></textarea></div>
      <div class="mb-3"><label class="form-label" for="notes">Notes for the pandit (optional)</label>
        <textarea class="form-control" id="notes" name="customer_notes" rows="3" maxlength="2000" placeholder="Occasion, family names for sankalp, language preference, parking info…"></textarea></div>
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="ack" required><label class="form-check-label small" for="ack">
        I understand that this is a <strong>booking request</strong>. It is confirmed only after the pandit accepts it.</label></div>
      <div class="d-grid"><button class="btn btn-primary btn-lg" id="submitBtn">Submit booking request</button></div>
    </form></div>
    <div class="col-lg-5"><div class="pf-card p-4 position-sticky" style="top:90px">
      <div class="d-flex gap-3 align-items-center mb-3">${avatar(p.name, p.photo_url)}<div><strong>${esc(p.name)}</strong>
        <div class="small text-muted">${esc(p.city)} · ${p.experience_years} yrs</div>${p.identity_verified ? '<span class="badge badge-verified rounded-pill">Verified</span>' : ''}</div></div>
      <div class="info-label">Service</div><div class="fw-semibold">${esc(service.name)}</div>
      <div class="small text-muted mb-3">${esc(service.category_name)} · ${duration(service.duration_minutes)}</div>
      <div class="info-label mb-1">Estimated cost</div>
      <table class="table table-sm mb-2"><tbody>
        <tr><td>Service price</td><td class="text-end">${rupees(service.price)}</td></tr>
        <tr id="travelRow"><td>Travel charge</td><td class="text-end" id="travelCell"></td></tr>
        <tr><td>Samagri</td><td class="text-end">${service.samagri_included ? 'Included' : 'Not included'}</td></tr>
        <tr class="fw-bold"><td>Estimated total</td><td class="text-end price-tag" id="totalCell"></td></tr></tbody></table>
      <div class="small text-muted">The final price is calculated by the server when you submit. Payment: pay later, or online once the pandit accepts (when enabled).</div>
    </div></div></div>`;

  const form = $('#bookForm');
  const modeVal = () => (form.service_mode ? form.querySelector('[name=service_mode]:checked').value : (service.mode === 'online' ? 'online' : 'in_person'));
  function updateCost() {
    const travel = modeVal() === 'in_person' && service.travel_charges_apply ? service.travel_charge : 0;
    $('#travelCell').textContent = travel ? rupees(travel) : '—';
    $('#totalCell').textContent = rupees(service.price + travel);
    $('#locLabel').textContent = modeVal() === 'online' ? 'Your city (for time-zone & sankalp)' : 'Ceremony location (locality, city)';
  }
  function updateSlot() {
    $('#slotSummary').innerHTML = date && start
      ? `<div class="notice"><i class="bi bi-calendar-event me-1"></i> <strong>${fmtDate(date)}</strong> at <strong>${fmtTime(start)}</strong>${slotEnd ? ` – ${fmtTime(slotEnd)}` : ''}</div>`
      : '<div class="alert alert-warning mb-0">Please choose a date and time.</div>';
  }
  form.addEventListener('change', updateCost);
  updateCost(); updateSlot();

  let calMounted = false;
  $('#changeSlot').addEventListener('click', () => {
    $('#calWrap').classList.toggle('d-none');
    if (!calMounted) {
      PFCalendar.mount($('#calWrap'), { panditId: p.id, serviceId: service.id, initialDate: date, onSelect(d, slot) { date = slot ? d : null; start = slot?.start || null; slotEnd = slot?.end || null; updateSlot(); } });
      calMounted = true;
    }
  });
  if (!date || !start) $('#changeSlot').click();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    if (!date || !start) return formError(form, new Error('Please choose a date and time slot.'));
    if (!$('#ack').checked) return formError(form, new Error('Please confirm you understand this is a booking request.'));
    await withBusy($('#submitBtn'), async () => {
      try {
        const b = await api('/api/bookings', { method: 'POST', body: {
          pandit_id: p.id, service_id: service.id, date, start_time: start, service_mode: modeVal(),
          location_text: form.location_text.value, samagri_requirements: form.samagri_requirements.value, customer_notes: form.customer_notes.value,
        } });
        location.href = `/booking.html?id=${b.id}&new=1`;
      } catch (err) {
        formError(form, err);
        if (err.status === 409) { $('#calWrap').classList.remove('d-none'); if (!calMounted) $('#changeSlot').click(); }
      }
    });
  });
})();
