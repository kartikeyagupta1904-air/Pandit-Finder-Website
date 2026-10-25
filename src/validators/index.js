'use strict';
const { badRequest } = require('../utils/errors');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{7,15}$/;

/**
 * Tiny declarative validator. Each rule describes one field; returns a clean
 * object containing only the declared fields or throws a 400 with field errors.
 *
 * rule = { type: 'string'|'int'|'bool'|'email'|'phone'|'enum'|'list'|'intList',
 *          required, min, max, values, trim (default true), default }
 */
function validate(input, rules) {
  const src = input || {};
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(rules)) {
    let v = src[field];
    const label = rule.label || field;
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

    if (empty) {
      if (rule.required) errors[field] = `${label} is required.`;
      else if (rule.default !== undefined) out[field] = rule.default;
      continue;
    }

    switch (rule.type) {
      case 'string':
      case 'email':
      case 'phone': {
        if (typeof v !== 'string' && typeof v !== 'number') { errors[field] = `${label} must be text.`; break; }
        v = String(v).trim();
        const min = rule.min ?? 0;
        const max = rule.max ?? 1000;
        if (v.length < min) errors[field] = `${label} must be at least ${min} characters.`;
        else if (v.length > max) errors[field] = `${label} must be at most ${max} characters.`;
        else if (rule.type === 'email' && !EMAIL_RE.test(v)) errors[field] = 'Enter a valid email address.';
        else if (rule.type === 'phone' && !PHONE_RE.test(v)) errors[field] = 'Enter a valid phone number.';
        else if (rule.pattern && !rule.pattern.test(v)) errors[field] = rule.patternMessage || `${label} is invalid.`;
        else out[field] = rule.type === 'email' ? v.toLowerCase() : v;
        break;
      }
      case 'int': {
        const n = typeof v === 'number' ? v : Number(String(v).trim());
        if (!Number.isInteger(n)) errors[field] = `${label} must be a whole number.`;
        else if (rule.min !== undefined && n < rule.min) errors[field] = `${label} must be at least ${rule.min}.`;
        else if (rule.max !== undefined && n > rule.max) errors[field] = `${label} must be at most ${rule.max}.`;
        else out[field] = n;
        break;
      }
      case 'bool': {
        if (v === true || v === 'true' || v === '1' || v === 1 || v === 'on') out[field] = true;
        else if (v === false || v === 'false' || v === '0' || v === 0 || v === 'off') out[field] = false;
        else errors[field] = `${label} must be true or false.`;
        break;
      }
      case 'enum': {
        if (!rule.values.includes(v)) errors[field] = `${label} must be one of: ${rule.values.join(', ')}.`;
        else out[field] = v;
        break;
      }
      case 'list':
      case 'intList': {
        // Accepts arrays, JSON arrays, or comma-separated strings (multipart forms).
        let arr = v;
        if (typeof v === 'string') {
          const t = v.trim();
          if (t.startsWith('[')) {
            try { arr = JSON.parse(t); } catch { arr = null; }
          } else {
            arr = t.split(',');
          }
        }
        if (!Array.isArray(arr)) { errors[field] = `${label} must be a list.`; break; }
        let items = arr.map((x) => String(x).trim()).filter(Boolean);
        if (rule.type === 'intList') {
          const nums = items.map(Number);
          if (nums.some((n) => !Number.isInteger(n) || n < (rule.itemMin ?? 1) || (rule.itemMax !== undefined && n > rule.itemMax))) { errors[field] = `${label} contains an invalid value.`; break; }
          items = nums;
        } else if (items.some((x) => x.length > (rule.itemMax || 80))) {
          errors[field] = `${label} has an item that is too long.`; break;
        }
        items = [...new Set(items)];
        if (rule.required && items.length === 0) errors[field] = `${label} is required.`;
        else if (rule.maxItems && items.length > rule.maxItems) errors[field] = `${label} can have at most ${rule.maxItems} items.`;
        else out[field] = items;
        break;
      }
      default:
        throw new Error(`Unknown rule type ${rule.type}`);
    }
  }

  if (Object.keys(errors).length) {
    throw badRequest(Object.values(errors)[0], errors);
  }
  return out;
}

function idParam(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`Invalid ${label}.`);
  return n;
}

const PASSWORD_RULE = { type: 'string', required: true, min: 8, max: 128, label: 'Password' };

function checkPasswordStrength(pw) {
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw badRequest('Password must contain at least one letter and one number.', { password: 'Use letters and numbers.' });
  }
}

module.exports = { validate, idParam, PASSWORD_RULE, checkPasswordStrength };
