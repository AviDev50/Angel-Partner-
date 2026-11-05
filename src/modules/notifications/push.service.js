import db from "../../config/db.js";
import { messaging } from "../../config/firebase.js";

export async function sendPushToUsers(userIds, { title, body, data = {} }) {
  try {
    if (!userIds.length) return;
    const [rows] = await db.query(
      `SELECT device_token_id, fcm_token FROM device_tokens
       WHERE user_id IN (?) AND deleted_at IS NULL`,
      [userIds],
    );
    const deadIds = [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk.map((r) => r.fcm_token),
        notification: { title, body },
        data: toStringMap(data),
        android: { priority: "high" },
      });
      res.responses.forEach((r, j) => {
        if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) deadIds.push(chunk[j].device_token_id);
      });
    }
    if (deadIds.length) {
      await db.query(`UPDATE device_tokens SET deleted_at = UTC_TIMESTAMP() WHERE device_token_id IN (?)`, [deadIds]);
    }
  } catch (err) {
    console.error("[push] bulk failed", err.message);
  }
}

export const sendPushToUser = (userId, payload) => sendPushToUsers([userId], payload);