import db from "../../config/db.js";

const COLUMNS = `
  notification_id, notification_type, title, message, entity_type, entity_id,
  announcement_id, is_read, read_at, created_at
`;

// ---------------- partner side
export async function listForUser({ userId, isRead, page, limit }) {
  const where = ["user_id = ?", "deleted_at IS NULL"];
  const params = [userId];
  if (isRead !== undefined) {
    where.push("is_read = ?");
    params.push(isRead);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${COLUMNS} FROM notifications WHERE ${whereSql}
     ORDER BY created_at DESC, notification_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${whereSql}`, params);
  return { rows, total };
}

export async function countUnread(userId) {
  const [[{ unread }]] = await db.query(
    `SELECT COUNT(*) AS unread FROM notifications
     WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
    [userId],
  );
  return unread;
}

export async function getForUser(id, userId) {
  const [rows] = await db.query(
    `SELECT ${COLUMNS} FROM notifications
     WHERE notification_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, userId],
  );
  return rows[0];
}

export async function markRead(id, userId) {
  await db.query(
    `UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP()
     WHERE notification_id = ? AND user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
    [id, userId],
  );
}

export async function markAllRead(userId) {
  const [res] = await db.query(
    `UPDATE notifications SET is_read = 1, read_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
    [userId],
  );
  return res.affectedRows;
}

// ---------------- admin side (announcements = send history)
export async function findActivePartners(ids, conn = db) {
  const [rows] = await conn.query(
    `SELECT u.user_id
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.user_id IN (?) AND r.role_name = 'partner'
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [ids],
  );
  return rows;
}

export async function insertAnnouncement(d, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO announcements (title, message, created_by, published_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP())`,
    [d.title, d.message, d.created_by],
  );
  return result.insertId;
}

export async function getAnnouncementForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM announcements WHERE announcement_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

// announcement + uski saari notifications permanently delete
export async function hardDeleteAnnouncement(id, conn = db) {
  await conn.query(`DELETE FROM notifications WHERE announcement_id = ?`, [id]);
  await conn.query(`DELETE FROM announcements WHERE announcement_id = ?`, [id]);
}

export async function listAnnouncements({ page, limit }) {
  const [rows] = await db.query(
    `SELECT a.announcement_id, a.title, a.message, a.published_at, a.created_at,
            u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM notifications n
              WHERE n.announcement_id = a.announcement_id AND n.deleted_at IS NULL) AS recipients,
            (SELECT COUNT(*) FROM notifications n
              WHERE n.announcement_id = a.announcement_id AND n.deleted_at IS NULL AND n.is_read = 1) AS read_count
     FROM announcements a
     JOIN users u ON u.user_id = a.created_by
     WHERE a.deleted_at IS NULL
     ORDER BY a.created_at DESC, a.announcement_id DESC
     LIMIT ? OFFSET ?`,
    [limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM announcements WHERE deleted_at IS NULL`);
  return { rows, total };
}

export async function deleteForUser(id, userId) {
  const [res] = await db.query(
    `DELETE FROM notifications WHERE notification_id = ? AND user_id = ?`,
    [id, userId],
  );
  return res.affectedRows;
}