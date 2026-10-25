'use strict';
// Dates are 'YYYY-MM-DD' strings; times are minutes since midnight in the server's local time zone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function parseTime(s) {
  if (typeof s !== 'string') return null;
  const m = TIME_RE.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today() {
  return toDateStr(new Date());
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}

/** Local Date for a date string + minutes. */
function toDateTime(dateStr, min) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60);
}

function hoursUntil(dateStr, min) {
  return (toDateTime(dateStr, min).getTime() - Date.now()) / 3600000;
}

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

module.exports = { isValidDate, parseTime, formatTime, toDateStr, today, addDays, toDateTime, hoursUntil, weekday };
