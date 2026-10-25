(async function () {
  'use strict';
  const { api, esc, $, $$, formError, clearFormError, withBusy } = PF;
  const form = $('#applyForm');
  await PF.ready;
  if (PF.state.me) {
    $('#loggedInNote').classList.remove('d-none');
    $('#logoutLink').onclick = async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
  }

  const [cats, cities, langs] = await Promise.all([api('/api/categories'), api('/api/cities'), api('/api/languages')]);
  $('#aCity').innerHTML += cities.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const box = (name, value, label) => `<input type="checkbox" class="btn-check" name="${name}" id="${name}-${esc(value)}" value="${esc(value)}"><label class="btn btn-sm btn-outline-saffron" for="${name}-${esc(value)}">${esc(label)}</label>`;
  $('#langBoxes').innerHTML = langs.map((l) => box('languages', l, l)).join('');
  $('#specBoxes').innerHTML = cats.map((c) => box('specializations', c.id, c.name)).join('');
  $('#dayBoxes').innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => box('availability_weekdays', i, d)).join('');
  $$('[name=availability_weekdays]').forEach((el) => { if (el.value !== '0') el.checked = true; });

  const catOptions = cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  function addServiceRow() {
    const row = document.createElement('div');
    row.className = 'service-item service-row';
    row.innerHTML = `<div class="row g-2">
      <div class="col-md-6"><label class="form-label small">Ceremony type</label><select class="form-select form-select-sm" data-f="category_id">${catOptions}</select></div>
      <div class="col-md-6"><label class="form-label small">Service name</label><input class="form-control form-control-sm" data-f="name" maxlength="120" placeholder="e.g. Griha Pravesh Puja"></div>
      <div class="col-6 col-md-3"><label class="form-label small">Price (₹)</label><input type="number" min="0" class="form-control form-control-sm" data-f="price"></div>
      <div class="col-6 col-md-3"><label class="form-label small">Duration</label><select class="form-select form-select-sm" data-f="duration_minutes">${[30, 60, 90, 120, 150, 180, 240, 300, 360].map((m) => `<option value="${m}" ${m === 120 ? 'selected' : ''}>${PF.duration(m)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Mode</label><select class="form-select form-select-sm" data-f="mode"><option value="in_person">In person</option><option value="online">Online</option><option value="both">Both</option></select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Travel charge (₹)</label><input type="number" min="0" class="form-control form-control-sm" data-f="travel_charge" placeholder="0 = none"></div>
      <div class="col-12"><div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" data-f="samagri_included"><label class="form-check-label small">Samagri included</label></div>
        <button type="button" class="btn btn-link btn-sm text-danger float-end remove-row">Remove</button></div>
    </div>`;
    row.querySelector('.remove-row').onclick = () => { if ($$('.service-row').length > 1) row.remove(); };
    $('#serviceRows').appendChild(row);
  }
  addServiceRow();
  $('#addService').onclick = addServiceRow;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    const services = $$('.service-row').map((r) => {
      const v = (f) => r.querySelector(`[data-f=${f}]`);
      const travel = Number(v('travel_charge').value || 0);
      return {
        category_id: Number(v('category_id').value), name: v('name').value.trim(), price: v('price').value === '' ? '' : Number(v('price').value),
        duration_minutes: Number(v('duration_minutes').value), mode: v('mode').value, samagri_included: v('samagri_included').checked,
        travel_charges_apply: travel > 0, travel_charge: travel,
      };
    });
    if (services.some((s) => !s.name || s.price === '')) return formError(form, new Error('Each service needs a name and a price.'));
    const checked = (n) => $$(`[name=${n}]:checked`).map((x) => x.value);
    if (!checked('languages').length) return formError(form, new Error('Select at least one language.'));
    if (!checked('specializations').length) return formError(form, new Error('Select at least one specialization.'));

    const fd = new FormData();
    for (const n of ['name', 'email', 'phone', 'password', 'preferred_contact', 'city_id', 'service_areas', 'experience_years', 'bio', 'availability_start', 'availability_end']) fd.append(n, form.elements[n].value);
    fd.append('languages', JSON.stringify(checked('languages')));
    fd.append('specializations', JSON.stringify(checked('specializations')));
    fd.append('availability_weekdays', JSON.stringify(checked('availability_weekdays')));
    fd.append('offers_online', $('#aOnline').checked ? 'true' : 'false');
    fd.append('consent', $('#aConsent').checked ? 'true' : 'false');
    fd.append('services', JSON.stringify(services));
    for (const n of ['photo', 'identity_document', 'certificate_document']) if (form.elements[n].files[0]) fd.append(n, form.elements[n].files[0]);

    await withBusy($('#applyBtn'), async () => {
      try {
        await api('/api/pandits/apply', { method: 'POST', form: fd });
        location.href = '/pandit-dashboard.html?applied=1';
      } catch (err) { formError(form, err); }
    });
  });
})();
