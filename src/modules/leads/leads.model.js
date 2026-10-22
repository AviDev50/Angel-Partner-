import db from "../../config/db.js";

const LEAD_FROM = `
  FROM leads l
  LEFT JOIN lead_assignments la
         ON la.lead_id = l.lead_id AND la.is_active = 1 AND la.deleted_at IS NULL
  LEFT JOIN users au ON au.user_id = la.assigned_user_id
  LEFT JOIN users sp ON sp.user_id = l.source_partner_id
`;

const LEAD_COLUMNS = `
  l.*,
  la.assignment_type  AS assignment_type,
  la.assigned_user_id AS assigned_user_id,
  au.full_name        AS assigned_user_name,
  la.assigned_at      AS assigned_at,
  sp.full_name        AS source_partner_name
`;

export async function getLeadById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${LEAD_COLUMNS} ${LEAD_FROM}
     WHERE l.lead_id = ? AND l.deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getLeadForUpdate(id, conn) {
  const [rows] = await conn.query(
    `SELECT * FROM leads WHERE lead_id = ? AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  return rows[0];
}

export async function listLeads({ status, leadSource, q, assignedUserId, assignmentType, unassigned, page, limit }) {
  const where = ["l.deleted_at IS NULL"];
  const params = [];

  if (status) {
    where.push("l.status = ?");
    params.push(status);
  }
  if (leadSource) {
    where.push("l.lead_source = ?");
    params.push(leadSource);
  }
  if (assignedUserId) {
    where.push("la.assigned_user_id = ?");
    params.push(assignedUserId);
  }
  if (assignmentType) {
    where.push("la.assignment_type = ?");
    params.push(assignmentType);
  }
  if (unassigned) {
    where.push("la.lead_assignment_id IS NULL");
  }
  if (q) {
    where.push("(l.customer_name LIKE ? OR l.customer_mobile LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like);
  }

  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${LEAD_COLUMNS} ${LEAD_FROM}
     WHERE ${whereSql}
     ORDER BY l.created_at DESC, l.lead_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total ${LEAD_FROM} WHERE ${whereSql}`,
    params,
  );

  return { rows, total };
}

export async function updateLeadStatus(id, status, conn = db) {
  await conn.query(`UPDATE leads SET status = ? WHERE lead_id = ?`, [status, id]);
}

// ---------------- assignments
export async function isActiveSalesAssignee(leadId, userId, conn = db) {
  const [rows] = await conn.query(
    `SELECT 1 FROM lead_assignments
     WHERE lead_id = ? AND assigned_user_id = ? AND assignment_type = 'sales_team'
       AND is_active = 1 AND deleted_at IS NULL
     LIMIT 1`,
    [leadId, userId],
  );
  return rows.length > 0;
}

export async function getActiveUserByRole(userId, roleName, conn = db) {
  const [rows] = await conn.query(
    `SELECT u.user_id, u.full_name
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.user_id = ? AND r.role_name = ?
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [userId, roleName],
  );
  return rows[0];
}

export async function getActiveAssignment(leadId, conn = db) {
  const [rows] = await conn.query(
    `SELECT lead_assignment_id, assigned_user_id
     FROM lead_assignments
     WHERE lead_id = ? AND is_active = 1 AND deleted_at IS NULL
     LIMIT 1`,
    [leadId],
  );
  return rows[0];
}

export async function closeAssignment(assignmentId, conn = db) {
  await conn.query(
    `UPDATE lead_assignments
     SET is_active = 0, unassigned_at = UTC_TIMESTAMP()
     WHERE lead_assignment_id = ?`,
    [assignmentId],
  );
}

export async function insertAssignment(data, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO lead_assignments
       (lead_id, assignment_type, assigned_user_id, assigned_by, remarks)
     VALUES (?, ?, ?, ?, ?)`,
    [data.lead_id, data.assignment_type, data.assigned_user_id, data.assigned_by, data.remarks],
  );
  return result.insertId;
}

export async function getAssignmentHistory(leadId, conn = db) {
  const [rows] = await conn.query(
    `SELECT la.lead_assignment_id, la.assignment_type, la.assigned_user_id,
            au.full_name AS assigned_user_name,
            la.assigned_by, bu.full_name AS assigned_by_name,
            la.is_active, la.assigned_at, la.unassigned_at, la.remarks
     FROM lead_assignments la
     JOIN users au ON au.user_id = la.assigned_user_id
     JOIN users bu ON bu.user_id = la.assigned_by
     WHERE la.lead_id = ? AND la.deleted_at IS NULL
     ORDER BY la.assigned_at DESC, la.lead_assignment_id DESC`,
    [leadId],
  );
  return rows;
}

// ---------------- follow-ups
export async function insertFollowUp(data, conn = db) {
  const [result] = await conn.query(
    `INSERT INTO follow_up_activities
       (lead_id, performed_by, activity_type, remarks, next_follow_up_at)
     VALUES (?, ?, ?, ?, ?)`,
    [data.lead_id, data.performed_by, data.activity_type, data.remarks, data.next_follow_up_at],
  );
  return result.insertId;
}

const FOLLOW_UP_SELECT = `
  SELECT f.follow_up_activity_id, f.lead_id, f.performed_by,
         u.full_name AS performed_by_name,
         f.activity_type, f.remarks, f.next_follow_up_at, f.created_at
  FROM follow_up_activities f
  JOIN users u ON u.user_id = f.performed_by
`;

export async function getFollowUpById(id, conn = db) {
  const [rows] = await conn.query(
    `${FOLLOW_UP_SELECT} WHERE f.follow_up_activity_id = ? AND f.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function getFollowUps(leadId, conn = db) {
  const [rows] = await conn.query(
    `${FOLLOW_UP_SELECT}
     WHERE f.lead_id = ? AND f.deleted_at IS NULL
     ORDER BY f.created_at DESC, f.follow_up_activity_id DESC`,
    [leadId],
  );
  return rows;
}

// ---------------- status history + notification
export async function getStatusHistory(leadId, conn = db) {
  const [rows] = await conn.query(
    `SELECT sh.status_history_id, sh.from_status, sh.to_status, sh.remarks,
            sh.created_at, u.full_name AS changed_by_name
     FROM status_histories sh
     JOIN users u ON u.user_id = sh.changed_by
     WHERE sh.entity_type = 'lead' AND sh.entity_id = ? AND sh.deleted_at IS NULL
     ORDER BY sh.created_at ASC, sh.status_history_id ASC`,
    [leadId],
  );
  return rows;
}

export async function createNotification(n, conn = db) {
  await conn.query(
    `INSERT INTO notifications
       (user_id, notification_type, title, message, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.user_id, n.type, n.title, n.message, n.entity_type, n.entity_id],
  );
}