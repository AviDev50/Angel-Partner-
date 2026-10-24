import db from "../../config/db.js";

const SELECT_REFERENCE = `
  SELECT r.*,
         u.full_name AS partner_name,
         u.mobile    AS partner_mobile,
         d.reference_code AS duplicate_of_reference_code,
         l.lead_id
  FROM customer_references r
  JOIN users u ON u.user_id = r.partner_id
  LEFT JOIN customer_references d
         ON d.customer_reference_id = r.duplicate_of_reference_id
  LEFT JOIN leads l
         ON l.customer_reference_id = r.customer_reference_id AND l.deleted_at IS NULL
`;

export async function findEarliestByMobile(mobile, conn = db) {
  const [rows] = await conn.query(
    `SELECT customer_reference_id
     FROM customer_references
     WHERE customer_mobile = ? AND deleted_at IS NULL
     ORDER BY created_at ASC, customer_reference_id ASC
     LIMIT 1`,
    [mobile],
  );
  return rows[0];
}

export async function insertReference(data, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO customer_references
       (partner_id, customer_name, customer_mobile, customer_email, preferred_bhk,
        customer_budget, preferred_project_location, remarks,
        is_potential_duplicate, duplicate_of_reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.partner_id,
      data.customer_name,
      data.customer_mobile,
      data.customer_email,
      data.preferred_bhk,
      data.customer_budget,
      data.preferred_project_location,
      data.remarks,
      data.is_potential_duplicate,
      data.duplicate_of_reference_id,
    ],
  );
  return result.insertId;
}

export async function setReferenceCode(id, code, conn = db) {
  await conn.query(
    `UPDATE customer_references SET reference_code = ? WHERE customer_reference_id = ?`,
    [code, id],
  );
}

export async function getReferenceById(id, conn = db) {
  const [rows] = await conn.query(
    `${SELECT_REFERENCE}
     WHERE r.customer_reference_id = ? AND r.deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getReferenceForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM customer_references
     WHERE customer_reference_id = ? AND deleted_at IS NULL
     FOR UPDATE`,
    [id],
  );
  return rows[0];
}

export async function listReferences({
  partnerId,
  status,
  q,
  isDuplicate,
  page,
  limit,
}) {
  const where = ["r.deleted_at IS NULL"];
  const params = [];

  if (partnerId) {
    where.push("r.partner_id = ?");
    params.push(partnerId);
  }
  if (status) {
    where.push("r.status = ?");
    params.push(status);
  }
  if (isDuplicate !== undefined) {
    where.push("r.is_potential_duplicate = ?");
    params.push(isDuplicate);
  }
  if (q) {
    where.push(
      "(r.customer_name LIKE ? OR r.customer_mobile LIKE ? OR r.reference_code LIKE ?)",
    );
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `${SELECT_REFERENCE}
     WHERE ${whereSql}
     ORDER BY r.created_at DESC, r.customer_reference_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM customer_references r WHERE ${whereSql}`,
    params,
  );

  return { rows, total };
}

export async function updateReview(id, status, reviewerId, remarks, conn = db) {
  await conn.query(
    `UPDATE customer_references
     SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_remarks = ?
     WHERE customer_reference_id = ?`,
    [status, reviewerId, remarks, id],
  );
}

// customer details lead mein copy hoti hain (schema ke comment ke hisaab se)
export async function createLeadFromReference(ref, adminId, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO leads
       (lead_source, customer_reference_id, source_partner_id, customer_name,
        customer_mobile, customer_email, preferred_bhk, customer_budget,
        preferred_project_location, remarks, created_by)
     VALUES ('partner_reference', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ref.customer_reference_id,
      ref.partner_id,
      ref.customer_name,
      ref.customer_mobile,
      ref.customer_email,
      ref.preferred_bhk,
      ref.customer_budget,
      ref.preferred_project_location,
      ref.remarks,
      adminId,
    ],
  );
  return result.insertId;
}

export async function addStatusHistory(h, conn = db) {
  await conn.query(
    `INSERT INTO status_histories
       (entity_type, entity_id, from_status, to_status, changed_by, remarks)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      h.entity_type,
      h.entity_id,
      h.from_status,
      h.to_status,
      h.changed_by,
      h.remarks,
    ],
  );
}

export async function getStatusHistory(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT sh.status_history_id, sh.from_status, sh.to_status, sh.remarks,
            sh.created_at, u.full_name AS changed_by_name
     FROM status_histories sh
     JOIN users u ON u.user_id = sh.changed_by
     WHERE sh.entity_type = 'customer_reference'
       AND sh.entity_id = ? AND sh.deleted_at IS NULL
     ORDER BY sh.created_at ASC, sh.status_history_id ASC`,
    [id],
  );
  return rows;
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications
       (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, 'customer_reference', ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_id],
  );
}

export async function updateStatus(id, status, conn = db) {
  await conn.query(
    `UPDATE customer_references SET status = ? WHERE customer_reference_id = ?`,
    [status, id],
  );
}
