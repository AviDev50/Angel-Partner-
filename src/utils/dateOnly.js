import { httpError } from "./httpError.js";

// YYYY-MM-DD, valid calendar date, future nahi. defaultToday=true => khali par aaj ki date.
export function parseDateOnly(value, field, { defaultToday = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (value === undefined || value === null || value === "") {
    if (defaultToday) return today;
    throw httpError(400, `${field} is required`);
  }
  const raw = String(value).trim();
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    throw httpError(400, `${field} must be YYYY-MM-DD`);
  }
  if (raw > today) throw httpError(400, `${field} cannot be in the future`);
  return raw;
}