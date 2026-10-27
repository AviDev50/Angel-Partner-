import db from "../../config/db.js";

const OPEN_LEAD = `('converted','lost','closed')`;
const ACTIVE_SALES_JOIN = `
  JOIN lead_assignments la
    ON la.lead_id = %LEAD% AND la.assignment_type = 'sales_team'
   AND la.is_active = 1 AND la.deleted_at IS NULL AND la.assigned_user_id = ?
`;
const salesJoin = (leadCol) => ACTIVE_SALES_JOIN.replace("%LEAD%", leadCol);

// date range condition. isDate=true => DATE column (string compare), warna DATETIME (UTC Date objects)
function rangeParts(col, r, isDate) {
  const sql = [];
  const params = [];
  const from = isDate ? r.fromDate : r.from;
  const to = isDate ? r.toDateExclusive : r.to;
  if (from) {
    sql.push(`${col} >= ?`);
    params.push(from);
  }
  if (to) {
    sql.push(`${col} < ?`);
    params.push(to);
  }
  return { sql: sql.length ? " AND " + sql.join(" AND ") : "", params };
}

// ================= admin
export async function adminActionCounts() {
  const [[row]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM customer_references
        WHERE deleted_at IS NULL AND status IN ('submitted','under_review')) AS references_pending_review,
      (SELECT COUNT(*) FROM leads l
        LEFT JOIN lead_assignments la
               ON la.lead_id = l.lead_id AND la.is_active = 1 AND la.deleted_at IS NULL
        WHERE l.deleted_at IS NULL AND la.lead_assignment_id IS NULL
          AND l.status NOT IN ${OPEN_LEAD}) AS leads_unassigned,
      (SELECT COUNT(*) FROM site_visits
        WHERE deleted_at IS NULL AND visit_status = 'completed') AS site_visits_pending_verification,
      (SELECT COUNT(*) FROM bookings
        WHERE deleted_at IS NULL AND booking_status = 'pending_verification') AS bookings_pending_verification,
      (SELECT COUNT(*) FROM commissions
        WHERE deleted_at IS NULL AND commission_status = 'approved') AS commissions_awaiting_payment,
      (SELECT COALESCE(SUM(commission_amount), 0) FROM commissions
        WHERE deleted_at IS NULL AND commission_status = 'approved') AS commissions_awaiting_payment_amount,
      (SELECT COUNT(*) FROM unwanted_leads
        WHERE deleted_at IS NULL AND partner_id IS NULL) AS unwanted_leads_unassigned
  `);
  return row;
}

export async function adminSnapshot() {
  const [[{ active_partners }]] = await db.query(
    `SELECT COUNT(*) AS active_partners
     FROM users u JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE r.role_name = 'partner' AND u.status = 'active' AND u.deleted_at IS NULL`,
  );
  const [leadRows] = await db.query(
    `SELECT status, COUNT(*) AS c FROM leads WHERE deleted_at IS NULL GROUP BY status`,
  );
  return { active_partners, leadRows };
}

export async function adminRangeStats(range) {
  const defs = [
    ["references_submitted", "SELECT COUNT(*) FROM customer_references WHERE deleted_at IS NULL", "created_at", false],
    ["leads_created", "SELECT COUNT(*) FROM leads WHERE deleted_at IS NULL", "created_at", false],
    ["site_visits_verified", "SELECT COUNT(*) FROM site_visits WHERE deleted_at IS NULL AND visit_status = 'verified'", "verified_at", false],
    ["bookings_confirmed", "SELECT COUNT(*) FROM bookings WHERE deleted_at IS NULL AND booking_status = 'booked'", "verified_at", false],
    ["points_issued", "SELECT COALESCE(SUM(points), 0) FROM points_transactions WHERE deleted_at IS NULL AND points > 0", "created_at", false],
    ["points_withdrawn", "SELECT COALESCE(SUM(-points), 0) FROM points_transactions WHERE deleted_at IS NULL AND points < 0", "created_at", false],
    ["commission_generated_count", "SELECT COUNT(*) FROM commissions WHERE deleted_at IS NULL AND commission_status <> 'cancelled'", "created_at", false],
    ["commission_generated_amount", "SELECT COALESCE(SUM(commission_amount), 0) FROM commissions WHERE deleted_at IS NULL AND commission_status <> 'cancelled'", "created_at", false],
    ["commission_paid_count", "SELECT COUNT(*) FROM commissions WHERE deleted_at IS NULL AND commission_status = 'paid'", "payment_date", true],
    ["commission_paid_amount", "SELECT COALESCE(SUM(commission_amount), 0) FROM commissions WHERE deleted_at IS NULL AND commission_status = 'paid'", "payment_date", true],
  ];

  const params = [];
  const selects = defs.map(([alias, base, col, isDate]) => {
    const r = rangeParts(col, range, isDate);
    params.push(...r.params);
    return `(${base}${r.sql}) AS ${alias}`;
  });

  const [[row]] = await db.query(`SELECT ${selects.join(",\n")}`, params);
  return row;
}

// ================= sales
export async function salesLeadsByStatus(userId) {
  const [rows] = await db.query(
    `SELECT l.status, COUNT(*) AS c
     FROM leads l ${salesJoin("l.lead_id")}
     WHERE l.deleted_at IS NULL
     GROUP BY l.status`,
    [userId],
  );
  return rows;
}

// har open lead ki LATEST follow-up dekhte hain; uske baad koi nayi activity nahi => wahi pending hai
//   overdue   : next_follow_up_at nikal chuka
//   due_today : abhi se aaj (IST) din khatam hone tak
export async function salesFollowUps(userId, endOfTodayIst) {
  const [[row]] = await db.query(
    `SELECT
       COALESCE(SUM(f.next_follow_up_at < UTC_TIMESTAMP()), 0) AS overdue,
       COALESCE(SUM(f.next_follow_up_at >= UTC_TIMESTAMP() AND f.next_follow_up_at < ?), 0) AS due_today
     FROM leads l
     ${salesJoin("l.lead_id")}
     JOIN follow_up_activities f ON f.follow_up_activity_id = (
       SELECT f2.follow_up_activity_id FROM follow_up_activities f2
       WHERE f2.lead_id = l.lead_id AND f2.deleted_at IS NULL
       ORDER BY f2.created_at DESC, f2.follow_up_activity_id DESC LIMIT 1)
     WHERE l.deleted_at IS NULL AND l.status NOT IN ${OPEN_LEAD}
       AND f.next_follow_up_at IS NOT NULL`,
    [endOfTodayIst, userId],
  );
  return row;
}

export async function salesAwaitingVerification(userId) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM site_visits sv ${salesJoin("sv.lead_id")}
         WHERE sv.deleted_at IS NULL AND sv.visit_status = 'completed') AS site_visits,
       (SELECT COUNT(*) FROM bookings b ${salesJoin("b.lead_id")}
         WHERE b.deleted_at IS NULL AND b.booking_status = 'pending_verification') AS bookings`,
    [userId, userId],
  );
  return row;
}

export async function salesUpcomingVisits(userId) {
  const base = `
    FROM site_visits sv
    JOIN leads l ON l.lead_id = sv.lead_id
    ${salesJoin("sv.lead_id")}
    WHERE sv.deleted_at IS NULL AND sv.visit_status = 'scheduled'
      AND sv.scheduled_at >= UTC_TIMESTAMP()`;
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${base}`, [userId]);
  const [items] = await db.query(
    `SELECT sv.site_visit_id, sv.lead_id, l.customer_name, sv.project_name, sv.scheduled_at
     ${base}
     ORDER BY sv.scheduled_at ASC, sv.site_visit_id ASC
     LIMIT 5`,
    [userId],
  );
  return { total, items };
}

// ================= partner
export async function partnerReferencesByStatus(partnerId) {
  const [rows] = await db.query(
    `SELECT status, COUNT(*) AS c FROM customer_references
     WHERE partner_id = ? AND deleted_at IS NULL GROUP BY status`,
    [partnerId],
  );
  return rows;
}

export async function partnerCounts(partnerId) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM unwanted_leads
         WHERE partner_id = ? AND deleted_at IS NULL) AS unwanted_leads_assigned,
       (SELECT COUNT(*) FROM notifications
         WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL) AS unread_notifications`,
    [partnerId, partnerId],
  );
  return row;
}