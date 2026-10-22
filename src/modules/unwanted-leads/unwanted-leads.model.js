import db from "../../config/db.js";

const SELECT_UL = `
  SELECT ul.*, p.full_name AS partner_name, p.mobile AS partner_mobile
  FROM unwanted_leads ul
  LEFT JOIN users p ON p.user_id = ul.partner_id
`;

export async function insertUnwantedLead(data, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO unwanted_leads
       (customer_name, customer_mobile, customer_email, preferred_bhk, customer_budget,
        preferred_project_location, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.customer_name,
      data.customer_mobile,
      data.customer_email,
      data.preferred_bhk,
      data.customer_budget,
      data.preferred_project_location,
      data.remarks,
      data.created_by,
    ],
  );
  return result.insertId;
}

export async function getUnwantedLeadById(id, conn = db) {
  const [rows] = await conn.query(
    `${SELECT_UL} WHERE ul.unwanted_lead_id = ? AND ul.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getUnwantedLeadForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM unwanted_leads WHERE unwanted_lead_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

export async function listUnwantedLeads({ partnerId, q, unassigned, page, limit }) {
  const where = ["ul.deleted_at IS NULL"];
  const params = [];

  if (partnerId) {
    where.push("ul.partner_id = ?");
    params.push(partnerId);
  }
  if (unassigned) where.push("ul.partner_id IS NULL");
  if (q) {
    where.push("(ul.customer_name LIKE ? OR ul.customer_mobile LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }

  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `${SELECT_UL}
     WHERE ${whereSql}
     ORDER BY ul.created_at DESC, ul.unwanted_lead_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM unwanted_leads ul WHERE ${whereSql}`,
    params,
  );

  return { rows, total };
}

export async function getActivePartner(userId, conn = db) {
  const [rows] = await conn.query(
    `SELECT u.user_id, u.full_name
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.user_id = ? AND r.role_name = 'partner'
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0];
}

export async function assignToPartner(id, partnerId, assignedBy, remarks, conn = db) {
  await conn.query(
    `UPDATE unwanted_leads
     SET partner_id = ?, assigned_by = ?, assigned_at = UTC_TIMESTAMP(), assignment_remarks = ?
     WHERE unwanted_lead_id = ?`,
    [partnerId, assignedBy, remarks, id],
  );
}

export async function addAuditLog(a, conn = db) {
  await conn.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
     VALUES (?, ?, 'unwanted_lead', ?, ?, ?)`,
    [a.user_id, a.action, a.entity_id, JSON.stringify(a.old_values), JSON.stringify(a.new_values)],
  );
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications
       (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, 'unwanted_lead', ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_id],
  );
}