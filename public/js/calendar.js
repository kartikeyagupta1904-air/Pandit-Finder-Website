/* Availability calendar + time-slot picker backed by /api/pandits/:id/availability. */
(function () {
  'use strict';
  const { api, esc, fmtTime, todayStr } = PF;

  /**
   * mount(el, { panditId, serviceId, onSelect(date, slot) })
   * Returns { setService(id) }.
   */
  function mount(el, opts) {
    let serviceId = opts.serviceId;
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let selectedDate = opts.initialDate || null;
    let selectedSlot = null;

    el.innerHTML = `<div class="d-flex justify-content-between align-items-center mb-2">
        <button type="button" class="btn btn-sm btn-outline-maroon cal-prev" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button>
        <strong class="cal-title"></strong>
        <button type="button" class="btn btn-sm btn-outline-maroon cal-next" aria-label="Next month"><i class="bi bi-chevron-right"></i></button></div>
      <div class="cal-grid mb-2">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="cal-head">${d}</div>`).join('')}</div>
      <div class="cal-grid cal-days"></div>
      <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
        <span><span class="badge" style="background:#edf8f0;border:1px solid #a8dbb8">&nbsp;</span> Available</span>
        <span><span class="badge" style="background:#f5f0ea">&nbsp;</span> Fully booked</span>
        <span><span class="badge" style="background:#fbeaea">&nbsp;</span> Unavailable</span></div>
      <div class="cal-slots mt-3"></div>`;

    const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    async function render() {
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      el.querySelector('.cal-title').textContent = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      el.querySelector('.cal-prev').disabled = year === now.getFullYear() && month === now.getMonth();
      const days = el.querySelector('.cal-days');
      days.innerHTML = '<div class="text-muted small" style="grid-column:1/-1">Loading availability…</div>';
      const from = ymd(year, month, 1) < todayStr() ? todayStr() : ymd(year, month, 1);
      const to = ymd(year, month, last.getDate());
      let map = {};
      if (from <= to) {
        try {
          const data = await api(`/api/pandits/${opts.panditId}/availability?from=${from}&to=${to}${serviceId ? `&service_id=${serviceId}` : ''}`);
          map = Object.fromEntries(data.days.map((d) => [d.date, d]));
        } catch (e) { days.innerHTML = `<div class="text-danger small" style="grid-column:1/-1">${esc(e.message)}</div>`; return; }
      }
      let html = '';
      for (let i = 0; i < first.getDay(); i++) html += '<div class="cal-day empty"></div>';
      for (let d = 1; d <= last.getDate(); d++) {
        const ds = ymd(year, month, d);
        const info = map[ds];
        const status = info ? info.status : 'past';
        const cls = { available: 'available', full: 'full', blocked: 'blocked' }[status] || '';
        const label = { available: `${info?.free_slots} start times available`, full: 'Fully booked', blocked: 'Unavailable', unavailable: 'No availability published' }[status] || 'Not bookable';
        html += `<button type="button" class="cal-day ${cls}${ds === selectedDate ? ' selected' : ''}" data-date="${ds}" ${status === 'available' ? '' : 'disabled'} title="${label}" aria-label="${ds}: ${label}">${d}</button>`;
      }
      days.innerHTML = html;
      days.querySelectorAll('.cal-day.available').forEach((b) => b.addEventListener('click', () => pickDate(b.dataset.date)));
      if (selectedDate && map[selectedDate]?.status === 'available') loadSlots(selectedDate);
    }

    async function pickDate(date) {
      selectedDate = date;
      selectedSlot = null;
      el.querySelectorAll('.cal-day').forEach((b) => b.classList.toggle('selected', b.dataset.date === date));
      opts.onSelect && opts.onSelect(null, null);
      loadSlots(date);
    }

    async function loadSlots(date) {
      const box = el.querySelector('.cal-slots');
      box.innerHTML = '<div class="small text-muted">Loading time slots…</div>';
      const data = await api(`/api/pandits/${opts.panditId}/availability?date=${date}${serviceId ? `&service_id=${serviceId}` : ''}`);
      if (!data.slots.length) { box.innerHTML = '<div class="small text-muted">No free time on this date.</div>'; return; }
      box.innerHTML = `<div class="small fw-semibold mb-2">Available start times on ${PF.fmtDate(date)} <span class="text-muted fw-normal">(${PF.duration(data.duration_minutes)} ceremony)</span></div>` +
        data.slots.map((s) => `<button type="button" class="slot-btn${selectedSlot === s.start ? ' active' : ''}" data-start="${s.start}" data-end="${s.end}">${fmtTime(s.start)}</button>`).join('');
      box.querySelectorAll('.slot-btn').forEach((b) => b.addEventListener('click', () => {
        box.querySelectorAll('.slot-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        selectedSlot = b.dataset.start;
        opts.onSelect && opts.onSelect(date, { start: b.dataset.start, end: b.dataset.end });
      }));
    }

    el.querySelector('.cal-prev').addEventListener('click', () => { month--; if (month < 0) { month = 11; year--; } render(); });
    el.querySelector('.cal-next').addEventListener('click', () => { month++; if (month > 11) { month = 0; year++; } render(); });
    if (selectedDate) { const [y, m] = selectedDate.split('-').map(Number); year = y; month = m - 1; }
    render();

    return {
      setService(id) { serviceId = id; selectedSlot = null; el.querySelector('.cal-slots').innerHTML = ''; opts.onSelect && opts.onSelect(null, null); render(); },
    };
  }

  window.PFCalendar = { mount };
})();
