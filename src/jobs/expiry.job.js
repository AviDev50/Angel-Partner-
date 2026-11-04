import { expireDueReferencesService } from "../modules/references/references.service.js";

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const n = await expireDueReferencesService();
    if (n) console.log(`[expiry] ${n} reference(s) expired`);
  } catch (err) {
    console.error("[expiry] job failed", err);
  } finally {
    running = false;
  }
}

export function startExpiryJob(everyMs = 5 * 60 * 1000) {
  setTimeout(tick, 10_000).unref();
  setInterval(tick, everyMs).unref();
}