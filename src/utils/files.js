import fs from "fs/promises";

// service fail hui to disk pe pada orphan file hata do
export async function removeUploaded(file) {
  if (!file) return;
  try { await fs.unlink(file.path); } catch { /* ignore */ }
}

const BASE_URL = process.env.BASE_URL?.replace(/\/+$/, "");
if (!BASE_URL) throw new Error("BASE_URL is not set in .env");

export const photoUrl = (filename) => (filename ? `${BASE_URL}/uploads/${filename}` : null);