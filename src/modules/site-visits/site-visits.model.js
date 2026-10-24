import db from "../../config/db.js";

const VISIT_COLUMNS = `
  sv.*,
  l.customer_name, l.customer_mobile, l.status AS lead_status,
  p.full_name  AS partner_name,
  sb.full_name AS scheduled_by_name,
  vb.full_name AS verified_by_name,
  la.assigned_user_id AS sales_user_id,
  pt.points AS points_credited
`;

const VISIT_FROM = `
  FROM site_visits sv
  JOIN leads l ON l.lead_id = sv.lead_id
  JOIN users sb ON sb.user_id = sv.scheduled_by
  LEFT JOIN users p  ON p.user_id  = sv.partner_id
  LEFT JOIN users vb ON vb.user_id = sv.verified_by
  LEFT JOIN lead_assignments la
         ON la.lead_id = sv.lead_id AND la.assignment_type = 'sales_team'
        AND la.is_active = 1 AND la.deleted_at IS NULL
  LEFT JOIN points_transactions pt
         ON pt.site_visit_id = sv.site_visit_id AND pt.transaction_type = 'site_visit_credit'
`;

export async function getVisitById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
     WHERE sv.site_visit_id = ? AND sv.deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getVisitForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM site_visits WHERE site_visit_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

// scheduled ya completed (verify hona baaki) => open
export async function findOpenVisit(leadId, conn = db) {
  const [rows] = await conn.query(
    `SELECT site_visit_id FROM site_visits
     WHERE lead_id = ? AND visit_status IN ('scheduled', 'completed') AND deleted_at IS NULL
     LIMIT 1`,
    [leadId],
  );
  return rows[0];
}

export async function insertVisit(data, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO site_visits (lead_id, partner_id, scheduled_by, project_name, scheduled_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.lead_id,
      data.partner_id,
      data.scheduled_by,
      data.project_name,
      data.scheduled_at,
    ],
  );
  return result.insertId;
}

export async function markCompleted(id, remarks, conn = db) {
  await conn.query(
    `UPDATE site_visits
     SET visit_status = 'completed', visit_remarks = ?, completed_at = UTC_TIMESTAMP()
     WHERE site_visit_id = ?`,
    [remarks, id],
  );
}

export async function markCancelled(id, conn = db) {
  await conn.query(
    `UPDATE site_visits SET visit_status = 'cancelled' WHERE site_visit_id = ?`,
    [id],
  );
}

export async function markVerification(
  id,
  status,
  verifierId,
  remarks,
  conn = db,
) {
  await conn.query(
    `UPDATE site_visits
     SET visit_status = ?, verified_by = ?, verified_at = UTC_TIMESTAMP(), verification_remarks = ?
     WHERE site_visit_id = ?`,
    [status, verifierId, remarks, id],
  );
}

export async function listVisits({
  visitStatus,
  leadId,
  partnerId,
  salesUserId,
  page,
  limit,
}) {
  const where = ["sv.deleted_at IS NULL"];
  const params = [];

  if (visitStatus) {
    where.push("sv.visit_status = ?");
    params.push(visitStatus);
  }
  if (leadId) {
    where.push("sv.lead_id = ?");
    params.push(leadId);
  }
  if (partnerId) {
    where.push("sv.partner_id = ?");
    params.push(partnerId);
  }
  if (salesUserId) {
    where.push("la.assigned_user_id = ?");
    params.push(salesUserId);
  }

  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
     WHERE ${whereSql}
     ORDER BY sv.scheduled_at DESC, sv.site_visit_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total ${VISIT_FROM} WHERE ${whereSql}`,
    params,
  );

  return { rows, total };
}

export async function getStatusHistory(visitId, conn = db) {
  const [rows] = await conn.query(
    `SELECT sh.status_history_id, sh.from_status, sh.to_status, sh.remarks,
            sh.created_at, u.full_name AS changed_by_name
     FROM status_histories sh
     JOIN users u ON u.user_id = sh.changed_by
     WHERE sh.entity_type = 'site_visit' AND sh.entity_id = ? AND sh.deleted_at IS NULL
     ORDER BY sh.created_at ASC, sh.status_history_id ASC`,
    [visitId],
  );
  return rows;
}

// cancel pe "pehle ka status" nikalne ke liye
export async function getPreviousStatus(
  entityType,
  entityId,
  toStatus,
  conn = db,
) {
  const [rows] = await conn.query(
    `SELECT from_status FROM status_histories
     WHERE entity_type = ? AND entity_id = ? AND to_status = ? AND deleted_at IS NULL
     ORDER BY created_at DESC, status_history_id DESC
     LIMIT 1`,
    [entityType, entityId, toStatus],
  );
  return rows[0]?.from_status ?? null;
}

export async function ensureWallet(partnerId, conn = db) {
  await conn.query(
    `INSERT IGNORE INTO partner_wallets (partner_id) VALUES (?)`,
    [partnerId],
  );
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
  await conn.query(
    `UPDATE partner_wallets SET points_balance = ? WHERE partner_wallet_id = ?`,
    [balance, walletId],
  );
}

export async function insertPointsCredit(data, conn = db) {
  try {
    await conn.query(
      `INSERT INTO points_transactions
         (partner_id, site_visit_id, transaction_type, points, balance_after, reason, performed_by)
       VALUES (?, ?, 'site_visit_credit', ?, ?, ?, ?)`,
      [
        data.partner_id,
        data.site_visit_id,
        data.points,
        data.balance_after,
        data.reason,
        data.performed_by,
      ],
    );
  } catch (err) {
    // uq_pt_one_credit_per_visit: ek visit pe ek hi credit
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error("Points already credited for this site visit");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications
       (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_type, n.entity_id],
  );
}
