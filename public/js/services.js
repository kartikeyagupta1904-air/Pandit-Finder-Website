(async function () {
  'use strict';
  const { api, esc, $, rupees, observeFade } = PF;
  const list = await api('/api/services');
  $('#svcGrid').innerHTML = list.map((c) => `<div class="col-md-6 col-lg-4 fade-up"><div class="pf-card hoverable p-4 h-100 d-flex flex-column">
    <div class="d-flex gap-3 align-items-center mb-2"><div class="stat-icon"><i class="bi ${esc(c.icon)}"></i></div><h5 class="mb-0">${esc(c.name)}</h5></div>
    <p class="small text-muted flex-grow-1">${esc(c.description)}</p>
    <div class="d-flex justify-content-between align-items-center">
      <div class="small">${c.pandit_count ? `${c.pandit_count} pandit${c.pandit_count === 1 ? '' : 's'} · ${rupees(c.min_price)}${c.max_price !== c.min_price ? ` – ${rupees(c.max_price)}` : ''}` : '<span class="text-muted">No pandits listed yet</span>'}</div>
      <a class="btn btn-sm btn-primary" href="/search.html?category=${encodeURIComponent(c.slug)}">Find pandits</a></div>
  </div></div>`).join('');
  observeFade();
})();
