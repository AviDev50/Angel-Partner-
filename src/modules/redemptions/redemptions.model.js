import db from "../../config/db.js";

const COLUMNS = `
  r.*, p.full_name AS partner_name,
  cb.full_name AS created_by_name, pr.full_name AS processed_by_name
`;
const FROM = `
  FROM redemptions r
  JOIN users p  ON p.user_id  = r.partner_id
  JOIN users cb ON cb.user_id = r.created_by
  LEFT JOIN users pr ON pr.user_id = r.processed_by
`;

export async function getRedemptionById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${COLUMNS} ${FROM} WHERE r.redemption_id = ? AND r.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

// admin ek hi step mein record karta hai: status seedha 'redeemed'
export async function insertRedemption(d, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO redemptions
       (partner_id, points_redeemed, reward_description, redemption_date, status, remarks, created_by, processed_by)
     VALUES (?, ?, ?, ?, 'redeemed', ?, ?, ?)`,
    [d.partner_id, d.points_redeemed, d.reward_description, d.redemption_date, d.remarks, d.admin_id, d.admin_id],
  );
  return result.insertId;
}

export async function listRedemptions({ partnerId, page, limit }) {
  const where = ["r.deleted_at IS NULL"];
  const params = [];
  if (partnerId) {
    where.push("r.partner_id = ?");
    params.push(partnerId);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${whereSql}
     ORDER BY r.redemption_date DESC, r.redemption_id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${whereSql}`, params);
  return { rows, total };
}