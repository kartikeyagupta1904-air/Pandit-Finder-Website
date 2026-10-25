(async function () {
  'use strict';
  const { api, esc, $, rupees, panditCard, stars, fmtDate, todayStr, observeFade } = PF;

  $('#hsDate').min = todayStr();
  $('#heroSearch').addEventListener('submit', (e) => {
    // Drop empty fields from the query string.
    [...e.target.elements].forEach((el) => { if (el.name && !el.value) el.disabled = true; });
  });

  const [cats, cities, recs, reviews, stats, settings] = await Promise.all([
    api('/api/categories'), api('/api/cities'), api('/api/pandits?sort=recommended&limit=6'),
    api('/api/reviews/recent'), api('/api/stats'), api('/api/settings/public'),
  ]).catch((e) => { PF.toast(e.message, 'error'); return [[], [], { results: [] }, [], {}, {}]; });

  $('#hsCat').innerHTML += cats.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('#cityList').innerHTML = cities.map((c) => `<option value="${esc(c.name)}">`).join('');
  document.querySelectorAll('.cancel-hours').forEach((el) => { el.textContent = settings.cancellation_hours ?? 24; });

  // Real counts only.
  const statItems = [];
  if (stats.pandits) statItems.push(`<span><i class="bi bi-person-check text-warning"></i> ${stats.pandits} verified pandit${stats.pandits === 1 ? '' : 's'}</span>`);
  if (stats.cities) statItems.push(`<span><i class="bi bi-geo text-warning"></i> ${stats.cities} cit${stats.cities === 1 ? 'y' : 'ies'}</span>`);
  if (stats.completed_ceremonies) statItems.push(`<span><i class="bi bi-stars text-warning"></i> ${stats.completed_ceremonies} ceremonies completed</span>`);
  $('#heroStats').innerHTML = statItems.join('');

  $('#categoryGrid').innerHTML = cats.map((c) => `<div class="col fade-up"><a class="pf-card hoverable category-tile" href="/search.html?category=${encodeURIComponent(c.slug)}">
    <div class="icon-wrap"><i class="bi ${esc(c.icon)}"></i></div><h6>${esc(c.name)}</h6></a></div>`).join('');

  if (recs.results.length) {
    $('#recommended').innerHTML = recs.results.map(panditCard).join('');
    if (recs.results.some((p) => p.is_sample)) $('#sampleNote').classList.remove('d-none');
  } else {
    $('#recommended').innerHTML = `<div class="col-12"><div class="pf-card empty-state"><i class="bi bi-person-badge"></i>
      <h5>No verified pandits yet</h5><p>Pandits appear here once their profile has been verified.</p>
      <a href="/become-pandit.html" class="btn btn-primary">Register as a pandit</a></div></div>`;
  }

  const popular = cities.filter((c) => c.pandit_count > 0).sort((a, b) => b.pandit_count - a.pandit_count);
  const shown = (popular.length ? popular : cities).slice(0, 14);
  $('#cityChips').innerHTML = shown.map((c) => `<a class="btn btn-outline-maroon" href="/search.html?city=${encodeURIComponent(c.name)}">
    <i class="bi bi-geo-alt"></i> ${esc(c.name)}${c.pandit_count ? ` <span class="badge bg-light text-dark ms-1">${c.pandit_count}</span>` : ''}</a>`).join('');

  $('#reviewsGrid').innerHTML = reviews.length
    ? reviews.map((r) => `<div class="col-md-6 col-lg-4 fade-up"><div class="pf-card p-4 h-100 d-flex flex-column">
        <div class="mb-2">${stars(r.rating)}</div>
        <p class="flex-grow-1">“${esc(r.comment)}”</p>
        <div class="small"><strong>${esc(r.customer_name)}</strong> · ${esc(r.ceremony_type)} with <a href="/pandit.html?id=${r.pandit_id}">${esc(r.pandit_name)}</a></div>
        <div class="small text-muted">${esc(r.city)} · ${fmtDate(r.created_at, { month: 'short', year: 'numeric' })}
          ${r.is_sample ? '<span class="badge badge-sample rounded-pill ms-1">Sample data</span>' : ''}</div>
      </div></div>`).join('')
    : '<div class="col-12"><div class="empty-state"><i class="bi bi-chat-quote"></i>Reviews from completed bookings will appear here.</div></div>';

  observeFade();
  void rupees;
})();
