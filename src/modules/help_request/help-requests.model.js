import db from "../../config/db.js";

const COLUMNS = `
  hr.help_request_id, hr.partner_id, hr.title, hr.message,
  hr.is_read, hr.read_at, hr.created_at,
  p.full_name AS partner_name, p.mobile AS partner_mobile
`;
const FROM = `
  FROM help_requests hr
  JOIN users p ON p.user_id = hr.partner_id
`;

export async function getHelpRequestById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${COLUMNS} ${FROM} WHERE hr.help_request_id = ? LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function insertHelpRequest(d, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO help_requests (partner_id, title, message) VALUES (?, ?, ?)`,
    [d.partner_id, d.title, d.message],
  );
  return result.insertId;
}

export async function listHelpRequests({ isRead, partnerId, page, limit }) {
  const where = ["1 = 1"];
  const params = [];
  if (isRead !== undefined) {
    where.push("hr.is_read = ?");
    params.push(isRead);
  }
  if (partnerId) {
    where.push("hr.partner_id = ?");
    params.push(partnerId);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${whereSql}
     ORDER BY hr.is_read ASC, hr.created_at DESC, hr.help_request_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${whereSql}`, params);
  return { rows, total };
}

export async function countUnread(conn = db) {
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM help_requests WHERE is_read = 0`);
  return total;
}

export async function markHelpRequestRead(id, conn = db) {
  await conn.query(
    `UPDATE help_requests SET is_read = 1, read_at = UTC_TIMESTAMP()
     WHERE help_request_id = ? AND is_read = 0`,
    [id],
  );
}

// HARD delete (intentional: no soft delete, no audit log for this module)
export async function deleteHelpRequest(id, conn = db) {
  const [result] = await conn.query(`DELETE FROM help_requests WHERE help_request_id = ?`, [id]);
  return result.affectedRows;
}

// ---------------------------------------------------------------- support number (single row, id = 1)
const SUPPORT_CONTACT_ID = 1;

export async function getSupportContact(conn = db) {
  const [rows] = await conn.query(
    `SELECT support_contact_id, phone_number, updated_at
     FROM support_contacts WHERE support_contact_id = ? LIMIT 1`,
    [SUPPORT_CONTACT_ID],
  );
  return rows[0];
}

export async function upsertSupportContact(d, conn = db) {
  await conn.query(
    `INSERT INTO support_contacts (support_contact_id, phone_number, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number), updated_by = VALUES(updated_by)`,
    [SUPPORT_CONTACT_ID, d.phone_number, d.updated_by],
  );
}