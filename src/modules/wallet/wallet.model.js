import db from "../../config/db.js";

// ---------------- reads
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

export async function getPointsTotals(partnerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN points > 0 THEN points END), 0) AS earned,
            COALESCE(SUM(CASE WHEN points < 0 THEN -points END), 0) AS withdrawn
     FROM points_transactions
     WHERE partner_id = ? AND deleted_at IS NULL`,
    [partnerId],
  );
  return rows[0];
}

export async function getCommissionTotals(partnerId, conn = db) {
  const [rows] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN commission_status = 'paid' THEN commission_amount END), 0) AS paid,
            COALESCE(SUM(CASE WHEN commission_status NOT IN ('paid', 'cancelled') THEN commission_amount END), 0) AS pending
     FROM commissions
     WHERE partner_id = ? AND deleted_at IS NULL`,
    [partnerId],
  );
  return rows[0];
}

export async function listTransactions({ partnerId, type, page, limit }, conn = db) {
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

export async function listCommissions({ partnerId, status, page, limit }, conn = db) {
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

  const [rows] = await conn.query(
    `SELECT c.commission_id, c.partner_id, c.booking_id, c.project_name, c.booking_date,
            c.commission_amount, c.commission_status, c.payment_date,
            c.payment_details, c.remarks, c.created_at
     FROM commissions c
     WHERE ${whereSql}
     ORDER BY c.created_at DESC, c.commission_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM commissions c WHERE ${whereSql}`,
    params,
  );
  return { rows, total };
}

// ---------------- writes (redemptions module use karega)
export async function ensureWallet(partnerId, conn = db) {
  await conn.query(`INSERT IGNORE INTO partner_wallets (partner_id) VALUES (?)`, [partnerId]);
}

export async function getWalletForUpdate(partnerId, conn) {
  const [rows] = await conn.query(
    `SELECT partner_wallet_id, points_balance FROM partner_wallets
     WHERE partner_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [partnerId],
  );
  return rows[0];
}

export async function setWalletBalance(walletId, balance, conn = db) {
  await conn.query(`UPDATE partner_wallets SET points_balance = ? WHERE partner_wallet_id = ?`, [balance, walletId]);
}

export async function insertPointsDebit(data, conn = db) {
  try {
    await conn.query(
      `INSERT INTO points_transactions
         (partner_id, redemption_id, transaction_type, points, balance_after, reason, performed_by)
       VALUES (?, ?, 'redemption_debit', ?, ?, ?, ?)`,
      [data.partner_id, data.redemption_id, -data.points, data.balance_after, data.reason, data.performed_by],
    );
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error("Points already deducted for this redemption");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_type, n.entity_id],
  );
}