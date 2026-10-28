// Excel-friendly CSV: UTF-8 BOM (Hindi naam sahi dikhein), CRLF, CSV-injection guard.
const BOM = "\uFEFF";

const pad = (n) => String(n).padStart(2, "0");

// DB UTC me hai, report IST me dikhao
function istDateTime(value) {
  const d = new Date(new Date(value).getTime() + 5.5 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// DATE columns UTC midnight Date aati hain => toISOString se wahi date
function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function cell(value, type) {
  if (value === null || value === undefined || value === "") return "";
  let s;
  if (type === "datetime") s = istDateTime(value);
  else if (type === "date") s = dateOnly(value);
  else if (typeof value === "number") s = String(value); // negative numbers ko guard nahi lagana
  else {
    s = String(value);
    // formula injection: =, +, -, @ (aur tab/CR) se shuru hone wale text ke aage ' laga do
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(r[c.key], c.type)).join(","));
  return BOM + [head, ...body].join("\r\n") + "\r\n";
}

export function sendCsv(res, { filename, columns, rows }) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(toCsv(columns, rows));
}