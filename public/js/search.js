(async function () {
  'use strict';
  const { api, esc, $, panditCard, todayStr, observeFade, fmtDate } = PF;
  const form = $('#filters');
  const results = $('#results');
  let page = 1;
  let reqId = 0;

  $('#fDate').min = todayStr();
  const [cats, cities, langs] = await Promise.all([api('/api/categories'), api('/api/cities'), api('/api/languages')]);
  $('#fCat').innerHTML += cats.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('#fCity').innerHTML += cities.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.pandit_count ? ` (${c.pandit_count})` : ''}</option>`).join('');
  $('#fLang').innerHTML += langs.map((l) => `<option>${esc(l)}</option>`).join('');

  // Prefill from URL so searches are shareable.
  const params = new URLSearchParams(location.search);
  for (const [k, v] of params) {
    const el = form.elements[k] || (k === 'sort' ? $('#sort') : null);
    if (!el) continue;
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) el.add(new Option(v, v));
    el.value = v;
  }

  function query() {
    const p = new URLSearchParams();
    for (const el of form.elements) if (el.name && el.value) p.set(el.name, el.value);
    if ($('#sort').value) p.set('sort', $('#sort').value);
    return p;
  }

  async function load(reset) {
    if (reset) page = 1;
    const p = query();
    history.replaceState(null, '', `/search.html${p.toString() ? `?${p}` : ''}`);
    p.set('page', page);
    p.set('limit', 9);
    const my = ++reqId;
    if (reset) results.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-warning"></div></div>';
    try {
      const data = await api(`/api/pandits?${p}`);
      if (my !== reqId) return; // a newer search started
      if (reset) results.innerHTML = '';
      const date = form.elements.date.value;
      $('#resultCount').textContent = `${data.total} pandit${data.total === 1 ? '' : 's'} found${date ? ` with open slots on ${fmtDate(date)}` : ''}`;
      if (!data.total) {
        results.innerHTML = `<div class="col-12"><div class="pf-card empty-state">
          <i class="bi bi-search-heart"></i><h5>No pandits match these filters</h5>
          <p class="mb-3">${date ? 'No pandit has published free time on that date for this ceremony. Try a nearby date or remove the date filter.' : 'Try another city, widen the price range, or remove a filter.'}</p>
          <button class="btn btn-primary" id="emptyReset">Clear all filters</button></div></div>`;
        $('#emptyReset').onclick = () => { form.reset(); $('#sort').value = 'recommended'; load(true); };
      } else {
        results.insertAdjacentHTML('beforeend', data.results.map(panditCard).join(''));
      }
      $('#sampleNote').classList.toggle('d-none', !results.querySelector('.badge-sample'));
      $('#loadMore').classList.toggle('d-none', page >= data.pages);
      observeFade();
    } catch (e) {
      results.innerHTML = `<div class="col-12"><div class="alert alert-danger">${esc(e.message)}</div></div>`;
    }
  }

  let t;
  form.addEventListener('input', (e) => { if (e.target.tagName === 'INPUT') { clearTimeout(t); t = setTimeout(() => load(true), 400); } });
  form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'date') load(true); });
  form.addEventListener('submit', (e) => { e.preventDefault(); load(true); });
  $('#sort').addEventListener('change', () => load(true)); // lives outside the <form> element
  $('#resetFilters').addEventListener('click', () => { form.reset(); $('#sort').value = 'recommended'; load(true); });
  $('#loadMore').addEventListener('click', () => { page++; load(false); });

  load(true);
})();
