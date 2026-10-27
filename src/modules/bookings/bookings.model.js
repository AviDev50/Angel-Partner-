import db from "../../config/db.js";

const COLUMNS = `
  b.*,
  l.customer_name, l.customer_mobile, l.status AS lead_status,
  p.full_name  AS partner_name,
  rb.full_name AS recorded_by_name,
  vb.full_name AS verified_by_name,
  la.assigned_user_id AS sales_user_id,
  c.commission_id, c.commission_amount, c.commission_status
`;

const FROM = `
  FROM bookings b
  JOIN leads l  ON l.lead_id = b.lead_id
  JOIN users rb ON rb.user_id = b.recorded_by
  LEFT JOIN users p  ON p.user_id  = b.partner_id
  LEFT JOIN users vb ON vb.user_id = b.verified_by
  LEFT JOIN lead_assignments la
         ON la.lead_id = b.lead_id AND la.assignment_type = 'sales_team'
        AND la.is_active = 1 AND la.deleted_at IS NULL
  LEFT JOIN commissions c ON c.booking_id = b.booking_id AND c.deleted_at IS NULL
`;

export async function getBookingById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${COLUMNS} ${FROM} WHERE b.booking_id = ? AND b.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getBookingForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM bookings WHERE booking_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

export async function findOpenBooking(leadId, conn = db) {
  const [rows] = await conn.query(
    `SELECT booking_id FROM bookings
     WHERE lead_id = ? AND booking_status = 'pending_verification' AND deleted_at IS NULL
     LIMIT 1`,
    [leadId],
  );
  return rows[0];
}

export async function insertBooking(d, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO bookings
       (lead_id, partner_id, project_name, booking_date, booking_status, remarks, recorded_by)
     VALUES (?, ?, ?, ?, 'pending_verification', ?, ?)`,
    [d.lead_id, d.partner_id, d.project_name, d.booking_date, d.remarks, d.recorded_by],
  );
  return result.insertId;
}

export async function markVerification(id, status, verifierId, remarks, conn = db) {
  await conn.query(
    `UPDATE bookings
     SET booking_status = ?, verified_by = ?, verified_at = UTC_TIMESTAMP(), verification_remarks = ?
     WHERE booking_id = ?`,
    [status, verifierId, remarks, id],
  );
}

export async function listBookings({ bookingStatus, leadId, partnerId, salesUserId, page, limit }) {
  const where = ["b.deleted_at IS NULL"];
  const params = [];
  if (bookingStatus) {
    where.push("b.booking_status = ?");
    params.push(bookingStatus);
  }
  if (leadId) {
    where.push("b.lead_id = ?");
    params.push(leadId);
  }
  if (partnerId) {
    where.push("b.partner_id = ?");
    params.push(partnerId);
  }
  if (salesUserId) {
    where.push("la.assigned_user_id = ?");
    params.push(salesUserId);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${whereSql}
     ORDER BY b.created_at DESC, b.booking_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${whereSql}`, params);
  return { rows, total };
}

export async function getStatusHistory(bookingId, conn = db) {
  const [rows] = await conn.query(
    `SELECT sh.status_history_id, sh.from_status, sh.to_status, sh.remarks,
            sh.created_at, u.full_name AS changed_by_name
     FROM status_histories sh
     JOIN users u ON u.user_id = sh.changed_by
     WHERE sh.entity_type = 'booking' AND sh.entity_id = ? AND sh.deleted_at IS NULL
     ORDER BY sh.created_at ASC, sh.status_history_id ASC`,
    [bookingId],
  );
  return rows;
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_type, n.entity_id],
  );
}