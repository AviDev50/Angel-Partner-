// modules/notifications/push.service.js
import db from "../../config/db.js";
import { messaging } from "../../config/firebase.js";

// Sirf ye codes matlab token hamesha ke liye invalid hai.
// invalid-argument yahan nahi rakha: wo payload bug ho sakta hai, token delete nahi karna.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

// FCM data me sirf string values allowed hain; null/undefined skip.
function toStringMap(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

export async function sendPushToUsers(userIds, { title, body, data = {} }) {
  try {
    if (!userIds?.length) return;

    const [rows] = await db.query(
      `SELECT device_token_id, fcm_token FROM device_tokens
       WHERE user_id IN (?) AND deleted_at IS NULL`,
      [userIds],
    );

    if (!rows.length) {
      console.log("[push] no active tokens for users:", userIds.join(","));
      return;
    }

    const payloadData = toStringMap(data);
    const deadIds = [];
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map((r) => r.fcm_token),
        notification: { title, body },
        data: payloadData,
        android: { priority: "high" },
      });

      ok += res.successCount;
      failed += res.failureCount;

      res.responses.forEach((r, j) => {
        if (r.success) return;
        console.error("[push] fail", r.error?.code, r.error?.message);
        if (DEAD_TOKEN_CODES.has(r.error?.code)) deadIds.push(chunk[j].device_token_id);
      });
    }

    console.log(`[push] users=${userIds.length} tokens=${rows.length} ok=${ok} fail=${failed}`);

    if (deadIds.length) {
      await db.query(
        `UPDATE device_tokens SET deleted_at = UTC_TIMESTAMP() WHERE device_token_id IN (?)`,
        [deadIds],
      );
      console.log(`[push] removed ${deadIds.length} dead token(s)`);
    }
  } catch (err) {
    console.error("[push] bulk failed:", err.code, err.message);
  }
}

export const sendPushToUser = (userId, payload) => sendPushToUsers([userId], payload);