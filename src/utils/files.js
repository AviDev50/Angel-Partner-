import fs from "fs/promises";

// service fail hui to disk pe pada orphan file hata do
export async function removeUploaded(file) {
  if (!file) return;
  try { await fs.unlink(file.path); } catch { /* ignore */ }
}