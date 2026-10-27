import { httpError } from "../../utils/httpError.js";
import * as model from "./dashboard.model.js";
import * as walletModel from "../wallet/wallet.model.js";

const REFERENCE_STATUSES = [
  "submitted", "under_review", "accepted", "rejected", "assigned_to_sales_team",
  "in_progress", "site_visit_scheduled", "site_visit_completed", "converted", "closed",
];
const LEAD_STATUSES = [
  "new", "contacted", "follow_up_required", "site_visit_scheduled", "site_visit_completed",
  "booking_in_progress", "converted", "lost", "closed",
];

const num = (v) => Number(v) || 0;

// har status ka count (jo na ho uska 0), frontend ko fill nahi karna padega
function byStatus(rows, statuses) {
  const out = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const r of rows) out[r.status] = num(r.c);
  return { total: Object.values(out).reduce((a, b) => a + b, 0), by_status: out };
}

// ---- date helpers (din IST ke hisaab se, DB UTC me hai)
function parseRangeDate(value, field) {
  const raw = String(value).trim();
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    throw httpError(400, `${field} must be YYYY-MM-DD`);
  }
  return raw;
}
const istStart = (dateStr) => new Date(`${dateStr}T00:00:00+05:30`);
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function endOfTodayIst() {
  const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return istStart(nextDay(todayIst));
}

function parseRange(query) {
  const range = { from: null, to: null, fromDate: null, toDateExclusive: null };
  const hasFrom = query.from !== undefined && query.from !== "";
  const hasTo = query.to !== undefined && query.to !== "";

  const from = hasFrom ? parseRangeDate(query.from, "from") : null;
  const to = hasTo ? parseRangeDate(query.to, "to") : null;
  if (from && to && from > to) throw httpError(400, "from cannot be after to");

  if (from) {
    range.fromDate = from;
    range.from = istStart(from);
  }
  if (to) {
    range.toDateExclusive = nextDay(to);
    range.to = istStart(range.toDateExclusive);
  }
  return { range, applied: from || to ? { from, to } : null };
}

export async function getDashboardService(user, query) {
  if (user.role === "admin") return adminDashboard(query);
  if (user.role === "sales_team") return salesDashboard(user);
  return partnerDashboard(user);
}

// ---------------------------------------------------------------- admin
async function adminDashboard(query) {
  const { range, applied } = parseRange(query);
  const [a, snap, s] = await Promise.all([
    model.adminActionCounts(),
    model.adminSnapshot(),
    model.adminRangeStats(range),
  ]);

  return {
    role: "admin",
    action_needed: {
      references_pending_review: num(a.references_pending_review),
      leads_unassigned: num(a.leads_unassigned),
      site_visits_pending_verification: num(a.site_visits_pending_verification),
      bookings_pending_verification: num(a.bookings_pending_verification),
      commissions_awaiting_payment: {
        count: num(a.commissions_awaiting_payment),
        amount: num(a.commissions_awaiting_payment_amount),
      },
      unwanted_leads_unassigned: num(a.unwanted_leads_unassigned),
    },
    snapshot: {
      active_partners: num(snap.active_partners),
      leads: byStatus(snap.leadRows, LEAD_STATUSES),
    },
    range: applied, // null => all-time
    stats: {
      references_submitted: num(s.references_submitted),
      leads_created: num(s.leads_created),
      site_visits_verified: num(s.site_visits_verified),
      bookings_confirmed: num(s.bookings_confirmed),
      points: { issued: num(s.points_issued), withdrawn: num(s.points_withdrawn) },
      commission: {
        generated: { count: num(s.commission_generated_count), amount: num(s.commission_generated_amount) },
        paid: { count: num(s.commission_paid_count), amount: num(s.commission_paid_amount) },
      },
    },
  };
}

// ---------------------------------------------------------------- sales (partner / commission info nahi)
async function salesDashboard(user) {
  const [leadRows, followUps, awaiting, upcoming] = await Promise.all([
    model.salesLeadsByStatus(user.user_id),
    model.salesFollowUps(user.user_id, endOfTodayIst()),
    model.salesAwaitingVerification(user.user_id),
    model.salesUpcomingVisits(user.user_id),
  ]);

  return {
    role: "sales_team",
    leads: byStatus(leadRows, LEAD_STATUSES),
    follow_ups: { overdue: num(followUps.overdue), due_today: num(followUps.due_today) },
    awaiting_admin_verification: {
      site_visits: num(awaiting.site_visits),
      bookings: num(awaiting.bookings),
    },
    upcoming_site_visits: { total: num(upcoming.total), items: upcoming.items },
  };
}

// ---------------------------------------------------------------- partner (wallet logic reuse)
async function partnerDashboard(user) {
  const id = user.user_id;
  const [refRows, wallet, pts, comm, counts] = await Promise.all([
    model.partnerReferencesByStatus(id),
    walletModel.getWallet(id),
    walletModel.getPointsTotals(id),
    walletModel.getCommissionTotals(id),
    model.partnerCounts(id),
  ]);

  const paid = num(comm.paid);
  const pending = num(comm.pending);

  return {
    role: "partner",
    references: byStatus(refRows, REFERENCE_STATUSES),
    points: {
      balance: wallet ? num(wallet.points_balance) : 0,
      total_earned: num(pts.earned),
      total_withdrawn: num(pts.withdrawn),
    },
    commission: { total: paid + pending, paid, pending },
    unwanted_leads_assigned: num(counts.unwanted_leads_assigned),
    unread_notifications: num(counts.unread_notifications),
  };
}