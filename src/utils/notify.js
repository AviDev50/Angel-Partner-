import db from "../config/db.js";

// Notification types (Flutter app icon/deep-link inko se map karega)
export const NOTIFY = {
  REGISTRATION: "registration_success",
  REFERENCE_SUBMITTED: "reference_submitted",
  REFERENCE_UNDER_REVIEW: "reference_under_review",
  REFERENCE_ACCEPTED: "reference_accepted",
  REFERENCE_REJECTED: "reference_rejected",
  REFERENCE_STATUS_UPDATED: "reference_status_updated",
  LEAD_ASSIGNED: "lead_assigned",
  UNWANTED_LEAD_ASSIGNED: "unwanted_lead_assigned",
  SITE_VISIT_SCHEDULED: "site_visit_scheduled",
  SITE_VISIT_CANCELLED: "site_visit_cancelled",
  SITE_VISIT_REJECTED: "site_visit_rejected",
  POINT_CREDITED: "point_credited",
  POINTS_WITHDRAWN: "points_withdrawn",
  COMMISSION_GENERATED: "commission_generated",
  COMMISSION_PAID: "commission_paid",
  ANNOUNCEMENT: "announcement",
  ADMIN_MESSAGE: "admin_message",
};

// partner ko dikhane ke liye IST format
export function formatIST(date) {
  return new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const INSERT_HEAD = `
  INSERT INTO notifications
    (user_id, notification_type, title, message, entity_type, entity_id, announcement_id)
`;
const PARTNER_FROM = `
  FROM users u
  JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
`;

function values(n) {
  return [
    n.type,
    String(n.title).slice(0, 200),
    String(n.message).slice(0, 1000),
    n.entityType ?? null,
    n.entityId ?? null,
    n.announcementId ?? null,
  ];
}

// Ek partner ko. INSERT...SELECT me role check hai => sales/admin ko kabhi notification nahi jayegi.
// Business transaction ke andar call karo (conn pass karo) taaki action fail ho to notification bhi na bane.
export async function notifyPartner(conn, { partnerId, ...n }) {
  const [res] = await (conn || db).query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE u.user_id = ? AND r.role_name = 'partner' AND u.deleted_at IS NULL`,
    [...values(n), partnerId],
  );
  return res.affectedRows;
}

// Kuch chuninda active partners ko (admin custom send)
export async function notifyPartners(conn, partnerIds, n) {
  const [res] = await (conn || db).query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE u.user_id IN (?) AND r.role_name = 'partner'
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [...values(n), partnerIds],
  );
  return res.affectedRows;
}

// Sab active partners ko (broadcast)
export async function notifyAllPartners(conn, n) {
  const [res] = await (conn || db).query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE r.role_name = 'partner' AND u.status = 'active' AND u.deleted_at IS NULL`,
    values(n),
  );
  return res.affectedRows;
}