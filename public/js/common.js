/* Shared helpers: API client (with CSRF), header/footer, formatting, toasts. */
(function () {
  'use strict';

  let csrfToken = null;
  const state = { me: null, unread: 0, settings: null };

  async function getCsrf(force) {
    if (!csrfToken || force) {
      const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      csrfToken = (await r.json()).csrfToken;
    }
    return csrfToken;
  }

  /** fetch wrapper: JSON in/out, CSRF header for writes, friendly errors. */
  async function api(path, { method = 'GET', body, form, retry = true } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') opts.headers['X-CSRF-Token'] = await getCsrf();
    if (form) opts.body = form;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 403 && retry && data && /session has expired/i.test(data.error || '')) {
      await getCsrf(true);
      return api(path, { method, body, form, retry: false });
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.fields = data && data.fields;
      throw err;
    }
    if (data && data.csrfToken) csrfToken = data.csrfToken;
    return data;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = (k) => new URLSearchParams(location.search).get(k);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const rupees = (n) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'));
  function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!d) return '—';
    const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-IN', opts);
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)} hr${min >= 120 ? 's' : ''}${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function stars(r) {
    if (r == null) return '<span class="text-muted small">No reviews yet</span>';
    const full = Math.round(r);
    return `<span class="rating-stars" aria-label="${r} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
  }

  function avatar(name, url, cls = '') {
    if (url) return `<img src="${esc(url)}" alt="${esc(name)}" class="avatar ${cls}" loading="lazy">`;
    const initials = String(name || '?').replace(/^(Pt\.|Acharya|Pandit)\s*/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `<div class="avatar avatar-initials ${cls}" aria-hidden="true">${esc(initials)}</div>`;
  }

  function statusBadge(status, label) {
    return `<span class="status-badge status-${esc(status)}">${esc(label || status)}</span>`;
  }

  function panditCard(p) {
    const specs = p.specializations.slice(0, 3).map((s) => `<span class="chip">${esc(s.name)}</span>`).join('');
    return `<div class="col-md-6 col-xl-4 fade-up"><div class="pf-card hoverable pandit-card">
      <div class="card-top">
        ${avatar(p.name, p.photo_url)}
        <div class="min-w-0">
          <h5 class="mb-1 fw-semibold" style="font-family:Poppins,sans-serif">${esc(p.name)}</h5>
          <div class="mb-1">
            ${p.identity_verified ? '<span class="badge badge-verified rounded-pill"><i class="bi bi-patch-check-fill"></i> Verified</span>' : ''}
            ${p.is_sample ? '<span class="badge badge-sample rounded-pill" title="Development sample data">Sample profile</span>' : ''}
          </div>
          <div class="small">${stars(p.rating)} ${p.rating != null ? `<strong>${p.rating}</strong> <span class="text-muted">(${p.review_count})</span>` : ''}</div>
        </div>
      </div>
      <div class="px-3 px-sm-4 pb-2 small flex-grow-1">
        <div class="mb-1"><i class="bi bi-geo-alt text-saffron"></i> ${esc(p.city)}${p.service_areas.length ? ` · ${esc(p.service_areas.slice(0, 2).join(', '))}` : ''}</div>
        <div class="mb-1"><i class="bi bi-award text-saffron"></i> ${p.experience_years} years experience</div>
        <div class="mb-2"><i class="bi bi-translate text-saffron"></i> ${esc(p.languages.join(', '))}</div>
        <div>${specs}</div>
        ${p.available_on ? `<div class="text-success small mt-1"><i class="bi bi-calendar-check"></i> Has open slots on ${fmtDate(p.available_on, { day: 'numeric', month: 'short' })}</div>` : ''}
      </div>
      <div class="d-flex align-items-center justify-content-between px-3 px-sm-4 py-3 border-top" style="border-color:var(--pf-border)!important">
        <div><div class="small text-muted">Starting from</div><div class="price-tag">${rupees(p.starting_price)}</div></div>
        <div class="d-flex gap-2 flex-wrap justify-content-end">
          <a href="/pandit.html?id=${p.id}#availability" class="btn btn-sm btn-outline-maroon">Check Availability</a>
          <a href="/pandit.html?id=${p.id}" class="btn btn-sm btn-primary">View Profile</a>
        </div>
      </div>
    </div></div>`;
  }

  function toast(message, type = 'success') {
    let c = $('.toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'toast-container position-fixed bottom-0 end-0 p-3'; document.body.appendChild(c); }
    const el = document.createElement('div');
    const color = type === 'error' ? 'text-bg-danger' : type === 'info' ? 'text-bg-dark' : 'text-bg-success';
    el.className = `toast align-items-center ${color} border-0`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
    c.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 4500 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  /** Shows a form-level error and highlights invalid fields returned by the server. */
  function formError(form, err) {
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
    $$('.invalid-feedback.server', form).forEach((el) => el.remove());
    if (err.fields) {
      for (const [name, msg] of Object.entries(err.fields)) {
        const input = form.elements[name];
        const el = input && (input.length && !input.tagName ? input[0] : input);
        if (el && el.classList) {
          el.classList.add('is-invalid');
          const fb = document.createElement('div');
          fb.className = 'invalid-feedback server';
          fb.textContent = msg;
          el.insertAdjacentElement('afterend', fb);
        }
      }
    }
    const box = $('.form-alert', form);
    if (box) { box.className = 'form-alert alert alert-danger'; box.textContent = err.message; box.scrollIntoView({ block: 'nearest' }); }
    else toast(err.message, 'error');
  }

  function clearFormError(form) {
    const box = $('.form-alert', form);
    if (box) { box.className = 'form-alert d-none'; box.textContent = ''; }
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
  }

  async function withBusy(btn, fn) {
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Please wait';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
  }

  const dashboardFor = (role) => ({ customer: '/customer-dashboard.html', pandit: '/pandit-dashboard.html', admin: '/admin.html' }[role] || '/');

  const LOGO = `<svg class="pf-brand-mark" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8772e"/><stop offset="1" stop-color="#7a1f2b"/></linearGradient></defs>
    <circle cx="32" cy="32" r="30" fill="url(#lg)"/><path d="M32 13c4 6 7 10 7 15a7 7 0 0 1-14 0c0-5 3-9 7-15z" fill="#fde9c4"/>
    <path d="M14 40c5 6 11 9 18 9s13-3 18-9H14z" fill="#f6ecc9"/><rect x="24" y="36" width="16" height="4" rx="2" fill="#c9a227"/></svg>`;

  function renderHeader() {
    const el = document.getElementById('site-header');
    if (!el) return;
    const me = state.me;
    const path = location.pathname;
    const link = (href, label) => `<li class="nav-item"><a class="nav-link${path === href ? ' active' : ''}" href="${href}">${label}</a></li>`;
    let right;
    if (me) {
      right = `<li class="nav-item dropdown me-xl-1">
          <a class="nav-link position-relative" href="#" id="notifToggle" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Notifications">
            <i class="bi bi-bell fs-5"></i>${state.unread ? `<span class="badge rounded-pill bg-danger notif-badge">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}
          </a>
          <div class="dropdown-menu dropdown-menu-end notif-menu p-0 shadow" id="notifMenu"><div class="p-3 text-muted small">Loading…</div></div>
        </li>
        <li class="nav-item dropdown">
          <a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown"><i class="bi bi-person-circle"></i> ${esc(me.name.split(' ')[0])}</a>
          <ul class="dropdown-menu dropdown-menu-end shadow">
            <li><a class="dropdown-item" href="${dashboardFor(me.role)}"><i class="bi bi-speedometer2 me-2"></i>Dashboard</a></li>
            <li><a class="dropdown-item" href="/account.html"><i class="bi bi-gear me-2"></i>Account settings</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="logoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Log out</button></li>
          </ul></li>`;
    } else {
      right = `<li class="nav-item"><a class="nav-link" href="/login.html">Login</a></li>
        <li class="nav-item ms-xl-1"><a class="btn btn-primary btn-sm px-3 mt-2 mt-xl-0" href="/register.html">Register</a></li>`;
    }
    el.innerHTML = `<nav class="navbar navbar-expand-xl pf-navbar sticky-top py-2"><div class="container">
      <a class="navbar-brand pf-brand" href="/">${LOGO}<span>Pandit Finder</span></a>
      <button class="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-controls="mainNav" aria-expanded="false" aria-label="Toggle navigation"><span class="navbar-toggler-icon"></span></button>
      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav mx-auto">
          ${link('/', 'Home')}${link('/search.html', 'Find a Pandit')}${link('/services.html', 'Puja Services')}
          <li class="nav-item"><a class="nav-link" href="/#how-it-works">How It Works</a></li>
          ${link('/become-pandit.html', 'Become a Pandit')}
        </ul>
        <ul class="navbar-nav align-items-xl-center">${right}</ul>
      </div></div></nav>`;
    const lo = document.getElementById('logoutBtn');
    if (lo) lo.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; });
    const nt = document.getElementById('notifToggle');
    if (nt) nt.addEventListener('show.bs.dropdown', loadNotifications);
  }

  async function loadNotifications() {
    const menu = document.getElementById('notifMenu');
    try {
      const data = await api('/api/notifications');
      if (!data.items.length) { menu.innerHTML = '<div class="p-4 text-center text-muted small">No notifications yet.</div>'; return; }
      menu.innerHTML = `<div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom"><strong class="small">Notifications</strong>
        <button class="btn btn-link btn-sm p-0" id="readAll">Mark all read</button></div>` +
        data.items.map((n) => `<a class="dropdown-item notif-item ${n.is_read ? '' : 'unread'} py-2 border-bottom text-wrap" href="${esc(n.link || '#')}" data-id="${n.id}">
          <div class="fw-semibold small">${esc(n.title)}</div><div class="small text-muted">${esc(n.body)}</div>
          <div class="text-muted" style="font-size:.7rem">${fmtDateTime(n.created_at)}</div></a>`).join('');
      $$('.notif-item', menu).forEach((a) => a.addEventListener('click', () => { api(`/api/notifications/${a.dataset.id}/read`, { method: 'POST' }).catch(() => {}); }));
      $('#readAll', menu).addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        await api('/api/notifications/read-all', { method: 'POST' });
        state.unread = 0; $$('.notif-item', menu).forEach((x) => x.classList.remove('unread'));
        const b = $('.notif-badge'); if (b) b.remove();
      });
    } catch (e) { menu.innerHTML = `<div class="p-3 small text-danger">${esc(e.message)}</div>`; }
  }

  async function renderFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    let s = state.settings;
    if (!s) { try { s = state.settings = await api('/api/settings/public'); } catch { s = {}; } }
    el.innerHTML = `<footer class="pf-footer"><div class="container"><div class="row g-4">
      <div class="col-lg-4"><div class="pf-brand text-white mb-2" style="color:#fff!important">${LOGO}<span style="color:#fff">Pandit Finder</span></div>
        <p class="small mb-2">Find Your Pandit. Celebrate Your Traditions.</p>
        <p class="small">A platform connecting families with verified pandits for pujas, havans and sanskars.</p></div>
      <div class="col-6 col-lg-2"><h6>Explore</h6><ul class="list-unstyled small">
        <li><a href="/search.html">Find a Pandit</a></li><li><a href="/services.html">Puja Services</a></li><li><a href="/#how-it-works">How It Works</a></li><li><a href="/#faq">FAQ</a></li></ul></div>
      <div class="col-6 col-lg-2"><h6>For Pandits</h6><ul class="list-unstyled small">
        <li><a href="/become-pandit.html">Become a Pandit</a></li><li><a href="/login.html">Pandit login</a></li></ul></div>
      <div class="col-6 col-lg-2"><h6>Policies</h6><ul class="list-unstyled small">
        <li><a href="/policies.html#privacy">Privacy policy</a></li><li><a href="/policies.html#terms">Terms of use</a></li><li><a href="/policies.html#cancellation">Cancellation policy</a></li></ul></div>
      <div class="col-6 col-lg-2"><h6>Contact</h6><ul class="list-unstyled small">
        <li><i class="bi bi-envelope me-1"></i>${esc(s.support_email || '')}</li><li><i class="bi bi-telephone me-1"></i>${esc(s.support_phone || '')}</li></ul></div>
    </div><div class="footer-bottom d-flex flex-wrap justify-content-between gap-2"><span>© ${new Date().getFullYear()} Pandit Finder</span><span>Made with respect for every tradition.</span></div></div></footer>`;
  }

  async function loadMe() {
    try {
      const data = await api('/api/auth/me');
      state.me = data.user;
      state.unread = data.unread_notifications || 0;
      state.meFull = data;
    } catch { state.me = null; }
    return state.me;
  }

  /** Redirects to login if not logged in or wrong role. Returns the user. */
  async function requireUser(roles) {
    await ready;
    if (!state.me) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('redirect'); }
    if (roles && !roles.includes(state.me.role)) { location.href = dashboardFor(state.me.role); throw new Error('redirect'); }
    return state.me;
  }

  function observeFade() {
    const els = $$('.fade-up:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  }

  const ready = loadMe().then(() => { renderHeader(); renderFooter(); });

  window.PF = { api, esc, qs, $, $$, rupees, fmtDate, fmtDateTime, fmtTime, duration, todayStr, stars, avatar, statusBadge, panditCard,
    toast, formError, clearFormError, withBusy, requireUser, dashboardFor, observeFade, state, ready, renderHeader };
})();
