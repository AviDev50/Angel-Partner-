import { httpError } from "./httpError.js";

// from/to (YYYY-MM-DD) IST din ke hisaab se; DB UTC me hai. Dono optional, dono inclusive.
function parseDay(value, field) {
  const raw = String(value).trim();
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    throw httpError(400, `${field} must be YYYY-MM-DD`);
  }
  return raw;
}

const istStart = (day) => new Date(`${day}T00:00:00+05:30`);

function nextDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function parseRange(query) {
  const has = (v) => v !== undefined && v !== null && v !== "";
  const from = has(query.from) ? parseDay(query.from, "from") : null;
  const to = has(query.to) ? parseDay(query.to, "to") : null;
  if (from && to && from > to) throw httpError(400, "from cannot be after to");

  const range = { from: null, to: null, fromDate: null, toDateExclusive: null };
  if (from) {
    range.fromDate = from;
    range.from = istStart(from);
  }
  if (to) {
    range.toDateExclusive = nextDay(to);
    range.to = istStart(range.toDateExclusive);
  }
  return { range, applied: from || to ? { from, to } : null };
}

// SQL condition: isDate=true => DATE column (string compare), warna DATETIME (UTC Date)
export function rangeCond(col, range, isDate = false) {
  const sql = [];
  const params = [];
  const from = isDate ? range.fromDate : range.from;
  const to = isDate ? range.toDateExclusive : range.to;
  if (from) {
    sql.push(`${col} >= ?`);
    params.push(from);
  }
  if (to) {
    sql.push(`${col} < ?`);
    params.push(to);
  }
  return { sql: sql.length ? " AND " + sql.join(" AND ") : "", params };
}