PF.api('/api/settings/public').then((s) => {
  document.querySelectorAll('.cancel-hours').forEach((el) => { el.textContent = s.cancellation_hours; });
}).catch(() => {});
