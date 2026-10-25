(async function () {
  'use strict';
  const { api, $, qs, formError, clearFormError, withBusy, dashboardFor } = PF;
  await PF.ready;

  // Only allow same-site relative redirects.
  const next = () => { const n = qs('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : null; };
  if (PF.state.me) { location.href = next() || dashboardFor(PF.state.me.role); return; }

  const login = $('#loginForm');
  if (login) login.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(login);
    await withBusy($('#loginBtn'), async () => {
      try {
        const { user } = await api('/api/auth/login', { method: 'POST', body: { email: login.email.value, password: login.password.value } });
        location.href = next() || dashboardFor(user.role);
      } catch (err) { formError(login, err); }
    });
  });

  const reg = $('#registerForm');
  if (reg) {
    api('/api/cities').then((c) => { $('#cityList').innerHTML = c.map((x) => `<option value="${PF.esc(x.name)}">`).join(''); }).catch(() => {});
    reg.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFormError(reg);
      if (reg.password.value !== reg.password2.value) return formError(reg, Object.assign(new Error('Passwords do not match.'), { fields: { password2: 'Passwords do not match.' } }));
      if (!$('#terms').checked) return formError(reg, new Error('Please accept the terms and privacy policy.'));
      await withBusy($('#regBtn'), async () => {
        try {
          await api('/api/auth/register', { method: 'POST', body: { name: reg.name.value, email: reg.email.value, password: reg.password.value, phone: reg.phone.value, city: reg.city.value } });
          location.href = next() || '/customer-dashboard.html?welcome=1';
        } catch (err) { formError(reg, err); }
      });
    });
  }
})();
