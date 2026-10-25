(async function () {
  'use strict';
  const { api, esc, $, qs, rupees, fmtDate, fmtTime, fmtDateTime, statusBadge, toast, formError, clearFormError, withBusy, avatar } = PF;
  const me = await PF.requireUser().catch(() => null);
  if (!me) return;
  const id = Number(qs('id'));
  const root = $('#bkRoot');
  $('#backLink').href = PF.dashboardFor(me.role);
  const modalEl = $('#actionModal');
  const modal = new bootstrap.Modal(modalEl);
  let settings = {};
  try { settings = await api('/api/settings/public'); } catch { /* ignore */ }

  /** Opens the shared modal; onSubmit(form) should throw to keep it open. */
  function openModal(title, bodyHtml, submitLabel, onSubmit, after) {
    $('#amTitle').textContent = title;
    $('#amBody').innerHTML = bodyHtml;
    $('#amSubmit').textContent = submitLabel;
    const form = $('#actionForm');
    clearFormError(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      clearFormError(form);
      await withBusy($('#amSubmit'), async () => {
        try { await onSubmit(form); modal.hide(); load(); } catch (err) { formError(form, err); }
      });
    };
    modal.show();
    if (after) after(form);
  }

  async function load() {
    let b;
    try { b = await api(`/api/bookings/${id}`); } catch (e) {
      root.innerHTML = `<div class="pf-card empty-state"><i class="bi bi-lock"></i><h5>Booking not available</h5><p>${esc(e.message)}</p></div>`;
      return;
    }
    $('#bkTitle').textContent = `${b.ceremony_type} · ${b.booking_ref}`;
    const perm = b.permissions;
    const isCustomer = b.viewer_role === 'customer';
    const isPandit = b.viewer_role === 'pandit';
    const pb = b.price_breakdown || {};

    const actions = [];
    if (perm.accept) actions.push('<button class="btn btn-primary" data-act="accept"><i class="bi bi-check2-circle"></i> Accept request</button>');
    if (perm.reject) actions.push('<button class="btn btn-outline-maroon" data-act="reject">Decline</button>');
    if (perm.confirm) actions.push('<button class="btn btn-primary" data-act="confirm"><i class="bi bi-check2-all"></i> Confirm booking</button>');
    if (perm.complete) actions.push('<button class="btn btn-maroon" data-act="complete">Mark ceremony completed</button>');
    if (perm.record_payment) actions.push('<button class="btn btn-outline-saffron" data-act="payment">Record payment received</button>');
    if (perm.reschedule) actions.push('<button class="btn btn-outline-maroon" data-act="reschedule"><i class="bi bi-calendar2-week"></i> Reschedule</button>');
    if (perm.cancel) actions.push('<button class="btn btn-outline-danger" data-act="cancel">Cancel booking</button>');

    const statusHelp = {
      pending: isCustomer ? 'Waiting for the pandit to accept. This request is not yet confirmed.' : 'Please accept or decline this request.',
      accepted: isCustomer ? 'The pandit accepted! Confirm the booking to lock it in.' : 'Waiting for the customer to confirm.',
      confirmed: 'This booking is confirmed. Coordinate final details through messages below.',
      completed: 'This ceremony is complete.',
      rejected: 'This request was declined.',
      cancelled: 'This booking was cancelled.',
    }[b.status];

    root.innerHTML = `${qs('new') ? `<div class="alert alert-success"><i class="bi bi-send-check"></i> Your booking request has been sent. The pandit will review it — it is <strong>not yet confirmed</strong>.</div>` : ''}
    <div class="row g-4">
      <div class="col-lg-8">
        <div class="pf-card p-4 mb-4">
          <div class="d-flex flex-wrap justify-content-between gap-2 mb-3">
            <div>${statusBadge(b.status, b.status_label)} <span class="small text-muted ms-2">Requested ${fmtDateTime(b.created_at)}</span></div>
            <div class="small text-muted">Booking ID <strong>${esc(b.booking_ref)}</strong></div>
          </div>
          <p class="mb-2">${esc(statusHelp)}</p>
          ${b.status_reason ? `<div class="alert alert-light border small"><strong>Reason:</strong> ${esc(b.status_reason)}</div>` : ''}
          <div class="row g-3 mt-1">
            <div class="col-sm-6"><div class="info-label">Date & time</div><div class="fw-semibold">${fmtDate(b.date)}</div><div>${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</div></div>
            <div class="col-sm-6"><div class="info-label">Service</div><div class="fw-semibold">${esc(b.service_name)}</div><div class="small">${b.service_mode === 'online' ? 'Online' : 'In person'}</div></div>
            <div class="col-sm-6"><div class="info-label">Location</div><div>${esc(b.location_text)}</div></div>
            <div class="col-sm-6"><div class="info-label">${isPandit ? 'Customer' : 'Pandit'}</div>
              <div class="d-flex align-items-center gap-2">${isPandit ? esc(b.customer_name) : `${avatar(b.pandit_name, b.pandit_photo_url)} <a href="/pandit.html?id=${b.pandit_id}">${esc(b.pandit_name)}</a>`}</div></div>
            <div class="col-sm-6"><div class="info-label">Samagri requirements</div><div class="small">${esc(b.samagri_requirements) || '—'}</div></div>
            <div class="col-sm-6"><div class="info-label">Customer notes</div><div class="small" style="white-space:pre-line">${esc(b.customer_notes) || '—'}</div></div>
          </div>
          ${b.contact ? `<div class="notice mt-3 small"><i class="bi bi-person-lines-fill"></i> <strong>Contact</strong> (shared because this booking is ${esc(b.status)}):
            ${b.contact.phone ? `Phone ${esc(b.contact.phone)}` : ''} ${b.contact.email ? ` · Email ${esc(b.contact.email)}` : ''}
            ${!b.contact.phone && !b.contact.email ? 'This pandit prefers to be contacted through platform messages.' : ''}</div>` : ''}
          ${actions.length ? `<div class="d-flex flex-wrap gap-2 mt-4">${actions.join('')}</div>` : ''}
        </div>

        ${b.viewer_role !== 'admin' ? `<div class="pf-card p-4 mb-4"><h5>Messages</h5><div id="msgList" class="mb-3" style="max-height:360px;overflow-y:auto"></div>
          ${['rejected', 'cancelled'].includes(b.status) ? '<div class="small text-muted">This conversation is closed.</div>' : `<form id="msgForm" class="d-flex gap-2">
            <label class="visually-hidden" for="msgBody">Message</label><input class="form-control" id="msgBody" name="body" maxlength="2000" required placeholder="Write a message…" autocomplete="off">
            <button class="btn btn-primary"><i class="bi bi-send"></i></button></form>`}</div>` : ''}

        ${isCustomer && perm.review ? `<div class="pf-card p-4 mb-4"><h5>Review your experience</h5>
          <form id="reviewForm" novalidate><div class="form-alert d-none"></div>
            <div class="mb-2" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<input type="radio" class="btn-check" name="rating" id="rt${n}" value="${n}" ${n === 5 ? 'checked' : ''}><label class="btn btn-outline-saffron btn-sm me-1" for="rt${n}">${n} ★</label>`).join('')}</div>
            <textarea class="form-control mb-2" name="comment" rows="3" maxlength="2000" placeholder="How was the ceremony? (optional)"></textarea>
            <button class="btn btn-primary">Submit review</button></form></div>` : ''}
        ${b.review ? `<div class="pf-card p-4 mb-4"><h5>Review</h5>${PF.stars(b.review.rating)} <span class="small text-muted">${fmtDate(b.review.created_at)}${b.review.status === 'hidden' ? ' · hidden by moderator' : ''}</span><p class="mb-0 mt-1">${esc(b.review.comment)}</p></div>` : ''}
      </div>

      <div class="col-lg-4">
        <div class="pf-card p-4 mb-4"><h5>Estimated cost</h5>
          <table class="table table-sm mb-2"><tbody>
            <tr><td>Service</td><td class="text-end">${rupees(pb.service_price)}</td></tr>
            <tr><td>Travel</td><td class="text-end">${pb.travel_charge ? rupees(pb.travel_charge) : '—'}</td></tr>
            <tr class="fw-bold"><td>Total</td><td class="text-end price-tag">${rupees(b.estimated_price)}</td></tr></tbody></table>
          <div class="info-label mt-2">Payments</div>
          ${b.payments.length ? b.payments.map((pay) => `<div class="small d-flex justify-content-between border-bottom py-1"><span>${{ pay_later: 'Pay later', razorpay: 'Online (Razorpay)', offline: 'Offline (recorded by pandit)' }[pay.provider]}</span>
            <span>${rupees(pay.amount)} · <strong>${esc(pay.status)}</strong></span></div>`).join('') : '<div class="small text-muted">No payment yet.</div>'}
        </div>
        <div class="pf-card p-4"><h5>History</h5><ul class="timeline small">
          ${b.events.map((e) => `<li><div class="fw-semibold text-capitalize">${esc(e.event.replace('_', ' '))}</div>
            <div class="text-muted">${fmtDateTime(e.created_at)}${e.actor_name ? ` · ${esc(e.actor_name)}` : ' · system'}</div>${e.note ? `<div>${esc(e.note)}</div>` : ''}</li>`).join('')}
        </ul></div>
      </div>
    </div>`;

    root.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => handle(btn.dataset.act, b, btn)));
    if ($('#msgList')) loadMessages();
    const mf = $('#msgForm');
    if (mf) mf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/api/bookings/${id}/messages`, { method: 'POST', body: { body: mf.body.value } }); mf.reset(); loadMessages(); } catch (err) { toast(err.message, 'error'); }
    });
    const rf = $('#reviewForm');
    if (rf) rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/bookings/${id}/review`, { method: 'POST', body: { rating: Number(rf.querySelector('[name=rating]:checked').value), comment: rf.comment.value } });
        toast('Thank you for your review!'); load();
      } catch (err) { formError(rf, err); }
    });
  }

  async function loadMessages() {
    const box = $('#msgList');
    const msgs = await api(`/api/bookings/${id}/messages`);
    box.innerHTML = msgs.length ? msgs.map((m) => `<div class="msg ${m.sender_id === me.id ? 'mine' : ''}"><div class="small fw-semibold">${esc(m.sender_name)}</div>
      <div style="white-space:pre-line">${esc(m.body)}</div><div class="text-muted" style="font-size:.7rem">${fmtDateTime(m.created_at)}</div></div>`).join('')
      : '<div class="small text-muted">No messages yet. Use this space to coordinate samagri, address and timings.</div>';
    box.scrollTop = box.scrollHeight;
  }

  async function handle(act, b, btn) {
    const reasonField = (label, req = true) => `<label class="form-label" for="amReason">${label}</label><textarea class="form-control" id="amReason" name="reason" rows="3" maxlength="500" ${req ? 'required' : ''}></textarea>`;
    if (act === 'accept') {
      await withBusy(btn, async () => {
        try { await api(`/api/bookings/${id}/status`, { method: 'PATCH', body: { status: 'accepted' } }); toast('Booking accepted. The customer has been notified.'); load(); } catch (e) { toast(e.message, 'error'); }
      });
    } else if (act === 'reject') {
      openModal('Decline booking request', reasonField('Reason (shared with the customer)'), 'Decline request',
        (f) => api(`/api/bookings/${id}/status`, { method: 'PATCH', body: { status: 'rejected', reason: f.reason.value } }));
    } else if (act === 'complete') {
      openModal('Mark as completed', '<p>Confirm that this ceremony has been performed. The customer will be invited to leave a review.</p>', 'Mark completed',
        () => api(`/api/bookings/${id}/status`, { method: 'PATCH', body: { status: 'completed' } }));
    } else if (act === 'payment') {
      openModal('Record payment received', `<p class="small">Record an amount you received directly from the customer (cash/UPI). This is shown as <em>self-reported</em>.</p>
        <label class="form-label" for="amAmt">Amount received (₹)</label><input type="number" class="form-control" id="amAmt" name="amount" min="0" value="${b.estimated_price}" required>`, 'Record payment',
        (f) => api(`/api/bookings/${id}/payments/offline`, { method: 'POST', body: { amount: Number(f.amount.value) } }));
    } else if (act === 'confirm') {
      const online = settings.online_payments;
      openModal('Confirm your booking', `<p>Choose how you'd like to pay:</p>
        <div class="form-check mb-2"><input class="form-check-input" type="radio" name="method" id="pmLater" value="pay_later" checked><label class="form-check-label" for="pmLater"><strong>Pay later</strong> — pay the pandit directly after the ceremony (${rupees(b.estimated_price)}).</label></div>
        <div class="form-check"><input class="form-check-input" type="radio" name="method" id="pmOnline" value="online" ${online ? '' : 'disabled'}><label class="form-check-label ${online ? '' : 'text-muted'}" for="pmOnline"><strong>Pay online</strong> ${online ? '— secure payment via Razorpay.' : '— not available: online payments are not configured on this platform yet.'}</label></div>`,
      'Confirm booking', async (f) => {
        if (f.querySelector('[name=method]:checked').value === 'online') return payOnline(b);
        await api(`/api/bookings/${id}/confirm`, { method: 'POST', body: { payment_method: 'pay_later' } });
        toast('Booking confirmed!');
      });
    } else if (act === 'cancel') {
      const policy = me.role === 'customer' && b.status !== 'pending' ? `<div class="notice small mb-2">Accepted bookings can be cancelled up to ${settings.cancellation_hours ?? 24} hours before the ceremony.</div>` : '';
      openModal('Cancel booking', `${policy}${reasonField('Reason for cancellation')}
        <div class="form-check mt-3"><input class="form-check-input" type="checkbox" id="amConfirm" name="confirm"><label class="form-check-label" for="amConfirm">Yes, I want to cancel booking ${esc(b.booking_ref)}. This cannot be undone.</label></div>`,
      'Cancel booking', async (f) => {
        if (!f.confirm.checked) throw new Error('Please tick the box to confirm cancellation.');
        const r = await api(`/api/bookings/${id}/cancel`, { method: 'POST', body: { reason: f.reason.value, confirm: true } });
        toast(r.refund_required ? 'Booking cancelled. An administrator will process your online refund.' : 'Booking cancelled.');
      });
    } else if (act === 'reschedule') {
      let pick = null;
      openModal('Reschedule booking', `<p class="small">Choose a new date and time. The pandit will need to accept the new time again.</p><div id="rsCal"></div>
        <label class="form-label mt-2" for="rsNote">Note (optional)</label><input class="form-control" id="rsNote" name="note" maxlength="500">`, 'Request new time',
      async (f) => {
        if (!pick) throw new Error('Choose a new date and time slot.');
        await api(`/api/bookings/${id}/reschedule`, { method: 'POST', body: { date: pick.date, start_time: pick.start, note: f.note.value } });
        toast('Reschedule requested. Waiting for the pandit to accept.');
      }, () => {
        PFCalendar.mount($('#rsCal'), { panditId: b.pandit_id, serviceId: b.service_id, onSelect(d, s) { pick = s ? { date: d, start: s.start } : null; } });
      });
    }
  }

  // Online payment: the browser only opens checkout; the server verifies the signature before confirming.
  async function payOnline(b) {
    const order = await api(`/api/bookings/${b.id}/payments/razorpay-order`, { method: 'POST' });
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve; s.onerror = () => reject(new Error('Could not load the payment window.'));
      document.head.appendChild(s);
    });
    const rzp = new window.Razorpay({
      key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
      name: 'Pandit Finder', description: `Booking ${order.booking_ref}`, theme: { color: '#7a1f2b' },
      handler: async (resp) => {
        try {
          await api('/api/payments/razorpay/verify', { method: 'POST', body: { order_id: resp.razorpay_order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature } });
          toast('Payment verified and booking confirmed.'); load();
        } catch (e) { toast(e.message, 'error'); }
      },
    });
    rzp.on('payment.failed', () => toast('Payment failed. You can try again or choose pay later.', 'error'));
    rzp.open();
  }

  load();
})();
