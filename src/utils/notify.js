import db from "../config/db.js";
import { sendPushToUsers } from "../modules/notifications/push.service.js";
import { runAfterCommit } from "./afterCommit.js";

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
  REFERENCE_EXPIRED: "reference_expired",
  BOOKING_CONFIRMED: "booking_confirmed",
  BOOKING_VERIFIED: "booking_verified",
  BOOKING_REJECTED: "booking_rejected",
  LEAD_ASSIGNED_TO_YOU: "lead_assigned_to_you",
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

// push ke liye title/body wahi jo in-app mein save hua (same truncation)
function pushPayload(n, extra = {}) {
  return {
    title: String(n.title).slice(0, 200),
    body: String(n.message).slice(0, 1000),
    data: {
      type: n.type,
      entity_type: n.entityType,
      entity_id: n.entityId,
      announcement_id: n.announcementId,
      ...extra,
    },
  };
}

export async function notifyPartner(conn, { partnerId, customerReferenceId, ...n }) {
  const params = [...values(n), partnerId];
  let skipExpired = "";
  if (customerReferenceId) {
    skipExpired = `AND NOT EXISTS (SELECT 1 FROM customer_references cr
                    WHERE cr.customer_reference_id = ? AND cr.expired_at IS NOT NULL)`;
    params.push(customerReferenceId);
  }
  const [res] = await (conn || db).query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE u.user_id = ? AND r.role_name = 'partner' AND u.deleted_at IS NULL
     ${skipExpired}`,
    params,
  );

  // affectedRows 0 => expired reference ki wajah se skip hua, push bhi nahi jayegi
  if (res.affectedRows) {
    runAfterCommit(conn, () =>
      sendPushToUsers([partnerId], pushPayload(n, { notification_id: res.insertId })),
    );
  }
  return res.affectedRows;
}

export async function notifyPartners(conn, partnerIds, n) {
  const c = conn || db;
  const [targets] = await c.query(
    `SELECT u.user_id ${PARTNER_FROM}
     WHERE u.user_id IN (?) AND r.role_name = 'partner'
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [partnerIds],
  );
  const [res] = await c.query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE u.user_id IN (?) AND r.role_name = 'partner'
       AND u.status = 'active' AND u.deleted_at IS NULL`,
    [...values(n), partnerIds],
  );

  if (res.affectedRows) {
    const ids = targets.map((t) => t.user_id);
    runAfterCommit(conn, () => sendPushToUsers(ids, pushPayload(n)));
  }
  return res.affectedRows;
}

export async function notifyAllPartners(conn, n) {
  const c = conn || db;
  const [targets] = await c.query(
    `SELECT u.user_id ${PARTNER_FROM}
     WHERE r.role_name = 'partner' AND u.status = 'active' AND u.deleted_at IS NULL`,
  );
  const [res] = await c.query(
    `${INSERT_HEAD}
     SELECT u.user_id, ?, ?, ?, ?, ?, ?
     ${PARTNER_FROM}
     WHERE r.role_name = 'partner' AND u.status = 'active' AND u.deleted_at IS NULL`,
    values(n),
  );

  if (res.affectedRows) {
    const ids = targets.map((t) => t.user_id);
    runAfterCommit(conn, () => sendPushToUsers(ids, pushPayload(n)));
  }
  return res.affectedRows;
}