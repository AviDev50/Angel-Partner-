import db from "../../config/db.js";
import { rangeCond } from "../../utils/dateRange.js";

const OPEN_LEAD = `('converted','lost','closed')`;
const num = (v) => Number(v) || 0;

function numify(rows, keys) {
  return rows.map((r) => {
    const o = { ...r };
    for (const k of keys) o[k] = num(o[k]);
    return o;
  });
}

// Har metric ek alag grouped subquery (k = user key). Row-wise correlated subquery se bachne ke liye.
// def = [alias, sql(with %R), dateColumn|null, isDate]
function buildDerived(defs, range, onCol) {
  const params = [];
  const joins = defs.map(([alias, base, col, isDate]) => {
    let sql = base.replace("%R", "");
    if (col) {
      const r = rangeCond(col, range, isDate);
      sql = base.replace("%R", r.sql);
      params.push(...r.params);
    }
    return `LEFT JOIN (${sql}) ${alias} ON ${alias}.k = ${onCol}`;
  });
  return { joins: joins.join("\n"), params };
}

// ================= 1. partner performance
const PARTNER_KEYS = [
  "references_submitted", "references_accepted", "references_rejected",
  "site_visits_verified", "bookings_confirmed", "points_earned", "points_withdrawn",
  "commission_generated", "commission_paid",
];

export async function partnerPerformance({ range, filters, limit, offset }) {
  const defs = [
    ["rs", "SELECT partner_id AS k, COUNT(*) AS v FROM customer_references WHERE deleted_at IS NULL%R GROUP BY partner_id", "created_at", false],
    // accepted = reference accept par lead banti hai
    ["ra", "SELECT source_partner_id AS k, COUNT(*) AS v FROM leads WHERE deleted_at IS NULL AND lead_source = 'partner_reference' AND source_partner_id IS NOT NULL%R GROUP BY source_partner_id", "created_at", false],
    ["rr", "SELECT partner_id AS k, COUNT(*) AS v FROM customer_references WHERE deleted_at IS NULL AND status = 'rejected'%R GROUP BY partner_id", "reviewed_at", false],
    ["sv", "SELECT partner_id AS k, COUNT(*) AS v FROM site_visits WHERE deleted_at IS NULL AND visit_status = 'verified' AND partner_id IS NOT NULL%R GROUP BY partner_id", "verified_at", false],
    ["bk", "SELECT partner_id AS k, COUNT(*) AS v FROM bookings WHERE deleted_at IS NULL AND booking_status = 'booked' AND partner_id IS NOT NULL%R GROUP BY partner_id", "verified_at", false],
    ["pe", "SELECT partner_id AS k, SUM(points) AS v FROM points_transactions WHERE deleted_at IS NULL AND points > 0%R GROUP BY partner_id", "created_at", false],
    ["pw", "SELECT partner_id AS k, SUM(-points) AS v FROM points_transactions WHERE deleted_at IS NULL AND points < 0%R GROUP BY partner_id", "created_at", false],
    ["cg", "SELECT partner_id AS k, SUM(commission_amount) AS v FROM commissions WHERE deleted_at IS NULL AND commission_status <> 'cancelled'%R GROUP BY partner_id", "created_at", false],
    ["cp", "SELECT partner_id AS k, SUM(commission_amount) AS v FROM commissions WHERE deleted_at IS NULL AND commission_status = 'paid'%R GROUP BY partner_id", "payment_date", true],
  ];
  const { joins, params } = buildDerived(defs, range, "p.user_id");

  const where = ["p.deleted_at IS NULL"];
  const wp = [];
  if (filters.partnerId) {
    where.push("p.user_id = ?");
    wp.push(filters.partnerId);
  }
  const from = `FROM users p
    JOIN roles ro ON ro.role_id = p.role_id AND ro.deleted_at IS NULL AND ro.role_name = 'partner'`;

  const [rows] = await db.query(
    `SELECT p.user_id AS partner_id, p.full_name AS partner_name, p.mobile AS partner_mobile, p.status AS partner_status,
            COALESCE(rs.v, 0) AS references_submitted, COALESCE(ra.v, 0) AS references_accepted,
            COALESCE(rr.v, 0) AS references_rejected, COALESCE(sv.v, 0) AS site_visits_verified,
            COALESCE(bk.v, 0) AS bookings_confirmed, COALESCE(pe.v, 0) AS points_earned,
            COALESCE(pw.v, 0) AS points_withdrawn, COALESCE(cg.v, 0) AS commission_generated,
            COALESCE(cp.v, 0) AS commission_paid
     ${from} ${joins}
     WHERE ${where.join(" AND ")}
     ORDER BY p.full_name ASC, p.user_id ASC
     LIMIT ? OFFSET ?`,
    [...params, ...wp, limit, offset],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${from} WHERE ${where.join(" AND ")}`, wp);
  return { rows: numify(rows, PARTNER_KEYS), total };
}

// ================= 2. funnel (cohort: range me bani references ka aage kya hua)
export async function funnel({ range, filters }) {
  const where = ["r.deleted_at IS NULL"];
  const params = [];
  const rc = rangeCond("r.created_at", range);
  params.push(...rc.params);
  let extra = rc.sql;
  if (filters.partnerId) {
    extra += " AND r.partner_id = ?";
    params.push(filters.partnerId);
  }

  const [[row]] = await db.query(
    `SELECT COUNT(*) AS submitted,
            COALESCE(SUM(r.status = 'rejected'), 0) AS rejected,
            COALESCE(SUM(l.lead_id IS NOT NULL), 0) AS accepted,
            COALESCE(SUM(l.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM site_visits sv
              WHERE sv.lead_id = l.lead_id AND sv.visit_status = 'verified' AND sv.deleted_at IS NULL)), 0) AS site_visits_verified,
            COALESCE(SUM(l.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM bookings b
              WHERE b.lead_id = l.lead_id AND b.booking_status = 'booked' AND b.deleted_at IS NULL)), 0) AS bookings_confirmed,
            COALESCE(SUM(l.status IN ('lost', 'closed')), 0) AS leads_lost_or_closed
     FROM customer_references r
     LEFT JOIN leads l ON l.customer_reference_id = r.customer_reference_id AND l.deleted_at IS NULL
     WHERE ${where.join(" AND ")}${extra}`,
    params,
  );
  return {
    submitted: num(row.submitted),
    rejected: num(row.rejected),
    accepted: num(row.accepted),
    site_visits_verified: num(row.site_visits_verified),
    bookings_confirmed: num(row.bookings_confirmed),
    leads_lost_or_closed: num(row.leads_lost_or_closed),
  };
}

// ================= 3. sales performance (jo action kiya uske naam par)
const SALES_KEYS = [
  "leads_assigned", "active_leads_now", "site_visits_scheduled", "site_visits_completed",
  "bookings_submitted", "bookings_verified", "leads_marked_lost",
];

export async function salesPerformance({ range, filters, limit, offset }) {
  const defs = [
    ["la", "SELECT assigned_user_id AS k, COUNT(DISTINCT lead_id) AS v FROM lead_assignments WHERE deleted_at IS NULL AND assignment_type = 'sales_team'%R GROUP BY assigned_user_id", "assigned_at", false],
    // snapshot (date range lagu nahi)
    ["an", `SELECT la2.assigned_user_id AS k, COUNT(*) AS v FROM lead_assignments la2 JOIN leads l2 ON l2.lead_id = la2.lead_id AND l2.deleted_at IS NULL
            WHERE la2.is_active = 1 AND la2.deleted_at IS NULL AND la2.assignment_type = 'sales_team' AND l2.status NOT IN ${OPEN_LEAD} GROUP BY la2.assigned_user_id`, null, false],
    ["vs", "SELECT scheduled_by AS k, COUNT(*) AS v FROM site_visits WHERE deleted_at IS NULL%R GROUP BY scheduled_by", "created_at", false],
    ["vc", "SELECT changed_by AS k, COUNT(*) AS v FROM status_histories WHERE entity_type = 'site_visit' AND to_status = 'completed' AND deleted_at IS NULL%R GROUP BY changed_by", "created_at", false],
    ["bs", "SELECT recorded_by AS k, COUNT(*) AS v FROM bookings WHERE deleted_at IS NULL%R GROUP BY recorded_by", "created_at", false],
    ["bv", "SELECT recorded_by AS k, COUNT(*) AS v FROM bookings WHERE deleted_at IS NULL AND booking_status = 'booked'%R GROUP BY recorded_by", "verified_at", false],
    ["ll", "SELECT changed_by AS k, COUNT(*) AS v FROM status_histories WHERE entity_type = 'lead' AND to_status = 'lost' AND deleted_at IS NULL%R GROUP BY changed_by", "created_at", false],
  ];
  const { joins, params } = buildDerived(defs, range, "u.user_id");

  const where = ["u.deleted_at IS NULL"];
  const wp = [];
  if (filters.salesUserId) {
    where.push("u.user_id = ?");
    wp.push(filters.salesUserId);
  }
  const from = `FROM users u
    JOIN roles ro ON ro.role_id = u.role_id AND ro.deleted_at IS NULL AND ro.role_name = 'sales_team'`;

  const [rows] = await db.query(
    `SELECT u.user_id AS sales_user_id, u.full_name AS sales_user_name, u.status AS sales_user_status,
            COALESCE(la.v, 0) AS leads_assigned, COALESCE(an.v, 0) AS active_leads_now,
            COALESCE(vs.v, 0) AS site_visits_scheduled, COALESCE(vc.v, 0) AS site_visits_completed,
            COALESCE(bs.v, 0) AS bookings_submitted, COALESCE(bv.v, 0) AS bookings_verified,
            COALESCE(ll.v, 0) AS leads_marked_lost
     ${from} ${joins}
     WHERE ${where.join(" AND ")}
     ORDER BY u.full_name ASC, u.user_id ASC
     LIMIT ? OFFSET ?`,
    [...params, ...wp, limit, offset],
  );
  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${from} WHERE ${where.join(" AND ")}`, wp);
  return { rows: numify(rows, SALES_KEYS), total };
}

// ================= 4. commissions
export async function commissions({ range, filters, limit, offset }) {
  const where = ["c.deleted_at IS NULL"];
  const params = [];
  if (filters.partnerId) {
    where.push("c.partner_id = ?");
    params.push(filters.partnerId);
  }
  if (filters.status) {
    where.push("c.commission_status = ?");
    params.push(filters.status);
  }
  const rc =
    filters.dateBy === "payment"
      ? rangeCond("c.payment_date", range, true)
      : rangeCond("c.created_at", range);
  params.push(...rc.params);
  const whereSql = where.join(" AND ") + rc.sql;

  const [rows] = await db.query(
    `SELECT c.commission_id, c.booking_id, c.partner_id, p.full_name AS partner_name,
            l.customer_name, c.project_name, c.booking_date, c.commission_amount,
            c.commission_status, c.payment_date, c.payment_details, c.remarks, c.created_at
     FROM commissions c
     JOIN users p    ON p.user_id = c.partner_id
     JOIN bookings b ON b.booking_id = c.booking_id
     JOIN leads l    ON l.lead_id = b.lead_id
     WHERE ${whereSql}
     ORDER BY c.created_at DESC, c.commission_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  // pura filtered set ka status-wise total (pagination se independent)
  const [sumRows] = await db.query(
    `SELECT c.commission_status AS status, COUNT(*) AS cnt, COALESCE(SUM(c.commission_amount), 0) AS amount
     FROM commissions c WHERE ${whereSql} GROUP BY c.commission_status`,
    params,
  );
  const byStatus = {};
  let total = 0;
  let amount = 0;
  for (const s of sumRows) {
    byStatus[s.status] = { count: num(s.cnt), amount: num(s.amount) };
    total += num(s.cnt);
    amount += num(s.amount);
  }
  return {
    rows: numify(rows, ["commission_amount"]),
    total,
    summary: { total_count: total, total_amount: amount, by_status: byStatus },
  };
}

// ================= 5. points ledger
export async function pointsLedger({ range, filters, limit, offset }) {
  const where = ["pt.deleted_at IS NULL"];
  const params = [];
  if (filters.partnerId) {
    where.push("pt.partner_id = ?");
    params.push(filters.partnerId);
  }
  if (filters.type) {
    where.push("pt.transaction_type = ?");
    params.push(filters.type);
  }
  const rc = rangeCond("pt.created_at", range);
  params.push(...rc.params);
  const whereSql = where.join(" AND ") + rc.sql;

  const [rows] = await db.query(
    `SELECT pt.points_transaction_id, pt.created_at, pt.partner_id, p.full_name AS partner_name,
            pt.transaction_type, pt.points, pt.balance_after, pt.reason,
            pt.site_visit_id, pt.redemption_id, pb.full_name AS performed_by_name
     FROM points_transactions pt
     JOIN users p  ON p.user_id  = pt.partner_id
     JOIN users pb ON pb.user_id = pt.performed_by
     WHERE ${whereSql}
     ORDER BY pt.created_at DESC, pt.points_transaction_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [[s]] = await db.query(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(CASE WHEN pt.points > 0 THEN pt.points END), 0) AS credits,
            COALESCE(SUM(CASE WHEN pt.points < 0 THEN -pt.points END), 0) AS debits
     FROM points_transactions pt WHERE ${whereSql}`,
    params,
  );
  return {
    rows: numify(rows, ["points", "balance_after"]),
    total: num(s.cnt),
    summary: { credits: num(s.credits), withdrawals: num(s.debits), net: num(s.credits) - num(s.debits) },
  };
}