import db from "../../config/db.js";

export async function getWallet(partnerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT points_balance FROM partner_wallets WHERE partner_id = ? AND deleted_at IS NULL LIMIT 1`,
    [partnerId],
  );
  return rows[0];
}

export async function getPartner(partnerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT u.user_id, u.full_name
     FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = ? AND r.role_name = 'partner' AND u.deleted_at IS NULL
     LIMIT 1`,
    [partnerId],
  );
  return rows[0];
}

export async function getTotals(partnerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN points > 0 THEN points END), 0) AS earned,
            COALESCE(SUM(CASE WHEN points < 0 THEN -points END), 0) AS spent
     FROM points_transactions
     WHERE partner_id = ? AND deleted_at IS NULL`,
    [partnerId],
  );
  return rows[0];
}

export async function listTransactions(
  { partnerId, type, page, limit },
  conn = db,
) {
  const where = ["pt.deleted_at IS NULL"];
  const params = [];
  if (partnerId) {
    where.push("pt.partner_id = ?");
    params.push(partnerId);
  }
  if (type) {
    where.push("pt.transaction_type = ?");
    params.push(type);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await conn.query(
    `SELECT pt.points_transaction_id, pt.partner_id, p.full_name AS partner_name,
            pt.transaction_type, pt.points, pt.balance_after, pt.reason,
            pt.site_visit_id, pt.redemption_id, pt.reverses_transaction_id,
            sv.project_name, pb.full_name AS performed_by_name, pt.created_at
     FROM points_transactions pt
     JOIN users p  ON p.user_id  = pt.partner_id
     JOIN users pb ON pb.user_id = pt.performed_by
     LEFT JOIN site_visits sv ON sv.site_visit_id = pt.site_visit_id
     WHERE ${whereSql}
     ORDER BY pt.created_at DESC, pt.points_transaction_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM points_transactions pt WHERE ${whereSql}`,
    params,
  );
  return { rows, total };
}
