import { httpError } from "./httpError.js";

// ISO-8601 with timezone, future only
export function parseFutureDateTime(value, field) {
  const raw = String(value ?? "").trim();
  if (!raw) throw httpError(400, `${field} is required`);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw httpError(400, `${field} must be ISO-8601 with timezone, e.g. 2026-10-25T11:30:00+05:30`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw httpError(400, `${field} is invalid`);
  if (d.getTime() <= Date.now()) throw httpError(400, `${field} must be in the future`);
  return d;
}