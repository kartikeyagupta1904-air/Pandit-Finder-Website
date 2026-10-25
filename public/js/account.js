(async function () {
  'use strict';
  const { api, $, toast, formError, clearFormError } = PF;
  const me = await PF.requireUser().catch(() => null);
  if (!me) return;
  const pf = $('#profileForm');
  const extra = PF.state.meFull?.profile || {};
  pf.name.value = me.name; $('#aEmail').value = me.email; pf.phone.value = me.phone || '';
  if (me.role === 'customer') { pf.city.value = extra.city || ''; pf.preferred_language.value = extra.preferred_language || ''; }
  else { $('#customerFields').classList.add('d-none'); }
  if (me.role === 'pandit') { $('#panditNote').classList.remove('d-none'); pf.classList.add('d-none'); }

  pf.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(pf);
    try {
      await api('/api/auth/profile', { method: 'PUT', body: { name: pf.name.value, phone: pf.phone.value, city: pf.city.value, preferred_language: pf.preferred_language.value } });
      toast('Profile saved.');
    } catch (err) { formError(pf, err); }
  });

  const pw = $('#pwForm');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault(); clearFormError(pw);
    if (pw.new_password.value !== pw.new_password2.value) return formError(pw, Object.assign(new Error('New passwords do not match.'), { fields: { new_password2: 'Does not match.' } }));
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { current_password: pw.current_password.value, new_password: pw.new_password.value } });
      pw.reset(); toast('Password changed.');
    } catch (err) { formError(pw, err); }
  });
})();
