import db from "../../config/db.js";

const COLUMNS = `
  c.*, p.full_name AS partner_name, cb.full_name AS created_by_name,
  b.lead_id, l.customer_name, l.customer_mobile
`;
const FROM = `
  FROM commissions c
  JOIN users p    ON p.user_id  = c.partner_id
  JOIN users cb   ON cb.user_id = c.created_by
  JOIN bookings b ON b.booking_id = c.booking_id
  JOIN leads l    ON l.lead_id = b.lead_id
`;

export async function getCommissionById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${COLUMNS} ${FROM} WHERE c.commission_id = ? AND c.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getCommissionForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM commissions WHERE commission_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

// booking se snapshot (project_name, booking_date) DB-side copy hota hai; verify par seedha 'approved'
export async function insertCommissionFromBooking(bookingId, amount, adminId, conn = db) {
  try {
    const [result] = await conn.query(
      `INSERT INTO commissions
         (booking_id, partner_id, project_name, booking_date, commission_amount, commission_status, created_by)
       SELECT booking_id, partner_id, project_name, booking_date, ?, 'approved', ?
       FROM bookings WHERE booking_id = ?`,
      [amount, adminId, bookingId],
    );
    return result.insertId;
  } catch (err) {
    // uq_comm_booking: ek booking pe ek hi commission
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error("Commission already exists for this booking");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function markPaid(id, paymentDate, paymentDetails, remarks, conn = db) {
  await conn.query(
    `UPDATE commissions
     SET commission_status = 'paid', payment_date = ?, payment_details = ?, remarks = COALESCE(?, remarks)
     WHERE commission_id = ?`,
    [paymentDate, paymentDetails, remarks, id],
  );
}

export async function listCommissions({ partnerId, status, page, limit }) {
  const where = ["c.deleted_at IS NULL"];
  const params = [];
  if (partnerId) {
    where.push("c.partner_id = ?");
    params.push(partnerId);
  }
  if (status) {
    where.push("c.commission_status = ?");
    params.push(status);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${whereSql}
     ORDER BY c.created_at DESC, c.commission_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${whereSql}`, params);
  return { rows, total };
}

export async function getStatusHistory(commissionId, conn = db) {
  const [rows] = await conn.query(
    `SELECT sh.status_history_id, sh.from_status, sh.to_status, sh.remarks,
            sh.created_at, u.full_name AS changed_by_name
     FROM status_histories sh
     JOIN users u ON u.user_id = sh.changed_by
     WHERE sh.entity_type = 'commission' AND sh.entity_id = ? AND sh.deleted_at IS NULL
     ORDER BY sh.created_at ASC, sh.status_history_id ASC`,
    [commissionId],
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