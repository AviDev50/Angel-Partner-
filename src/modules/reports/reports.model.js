import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { parseRange } from "../../utils/dateRange.js";
import * as model from "./reports.model.js";

const MAX_CSV_ROWS = 50000;
const COMMISSION_STATUSES = ["pending_eligibility", "generated", "approved", "payment_processing", "paid", "cancelled"];
const POINT_TYPES = ["site_visit_credit", "redemption_debit", "reversal", "correction"];

function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const id = parsePositiveInt(value);
  if (!id) throw httpError(400, `Invalid ${field}`);
  return id;
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

// ---- CSV columns (header + type: datetime / date / default)
const COLUMNS = {
  "partner-performance": [
    { key: "partner_id", header: "Partner ID" },
    { key: "partner_name", header: "Partner" },
    { key: "partner_mobile", header: "Mobile" },
    { key: "partner_status", header: "Status" },
    { key: "references_submitted", header: "References Submitted" },
    { key: "references_accepted", header: "References Accepted" },
    { key: "references_rejected", header: "References Rejected" },
    { key: "site_visits_verified", header: "Site Visits Verified" },
    { key: "bookings_confirmed", header: "Bookings Confirmed" },
    { key: "points_earned", header: "Points Earned" },
    { key: "points_withdrawn", header: "Points Withdrawn" },
    { key: "commission_generated", header: "Commission Generated" },
    { key: "commission_paid", header: "Commission Paid" },
  ],
  funnel: [
    { key: "label", header: "Step" },
    { key: "count", header: "Count" },
    { key: "pct_of_submitted", header: "% of Submitted" },
    { key: "pct_of_accepted", header: "% of Accepted" },
  ],
  "sales-performance": [
    { key: "sales_user_id", header: "User ID" },
    { key: "sales_user_name", header: "Sales Member" },
    { key: "sales_user_status", header: "Status" },
    { key: "leads_assigned", header: "Leads Assigned" },
    { key: "active_leads_now", header: "Active Leads Now" },
    { key: "site_visits_scheduled", header: "Site Visits Scheduled" },
    { key: "site_visits_completed", header: "Site Visits Completed" },
    { key: "bookings_submitted", header: "Bookings Submitted" },
    { key: "bookings_verified", header: "Bookings Verified" },
    { key: "leads_marked_lost", header: "Leads Marked Lost" },
  ],
  commissions: [
    { key: "commission_id", header: "Commission ID" },
    { key: "booking_id", header: "Booking ID" },
    { key: "partner_name", header: "Partner" },
    { key: "customer_name", header: "Customer" },
    { key: "project_name", header: "Project" },
    { key: "booking_date", header: "Booking Date", type: "date" },
    { key: "commission_amount", header: "Amount" },
    { key: "commission_status", header: "Status" },
    { key: "payment_date", header: "Payment Date", type: "date" },
    { key: "payment_details", header: "Payment Details" },
    { key: "remarks", header: "Remarks" },
    { key: "created_at", header: "Generated At (IST)", type: "datetime" },
  ],
  "points-ledger": [
    { key: "points_transaction_id", header: "Txn ID" },
    { key: "created_at", header: "Date (IST)", type: "datetime" },
    { key: "partner_name", header: "Partner" },
    { key: "transaction_type", header: "Type" },
    { key: "points", header: "Points" },
    { key: "balance_after", header: "Balance After" },
    { key: "reason", header: "Reason" },
    { key: "site_visit_id", header: "Site Visit ID" },
    { key: "redemption_id", header: "Redemption ID" },
    { key: "performed_by_name", header: "Performed By" },
  ],
};

// ---- har report: filters parse + data fetch. paged:false => chhota summary report
const REPORTS = {
  "partner-performance": {
    parseFilters: (q) => ({ partnerId: optionalId(q.partner_id, "partner_id") }),
    fetch: model.partnerPerformance,
  },
  "sales-performance": {
    parseFilters: (q) => ({ salesUserId: optionalId(q.sales_user_id, "sales_user_id") }),
    fetch: model.salesPerformance,
  },
  commissions: {
    parseFilters: (q) => {
      if (q.commission_status && !COMMISSION_STATUSES.includes(q.commission_status)) {
        throw httpError(400, "Invalid commission_status");
      }
      if (q.date_by && !["created", "payment"].includes(q.date_by)) {
        throw httpError(400, "date_by must be 'created' or 'payment'");
      }
      return {
        partnerId: optionalId(q.partner_id, "partner_id"),
        status: q.commission_status || null,
        dateBy: q.date_by || "created",
      };
    },
    fetch: model.commissions,
  },
  "points-ledger": {
    parseFilters: (q) => {
      if (q.transaction_type && !POINT_TYPES.includes(q.transaction_type)) {
        throw httpError(400, "Invalid transaction_type");
      }
      return {
        partnerId: optionalId(q.partner_id, "partner_id"),
        type: q.transaction_type || null,
      };
    },
    fetch: model.pointsLedger,
  },
  funnel: {
    paged: false,
    parseFilters: (q) => ({ partnerId: optionalId(q.partner_id, "partner_id") }),
    fetch: async ({ range, filters }) => {
      const f = await model.funnel({ range, filters });
      const step = (key, label, count, afterAccepted) => ({
        key,
        label,
        count,
        pct_of_submitted: pct(count, f.submitted),
        pct_of_accepted: afterAccepted ? pct(count, f.accepted) : null,
      });
      const rows = [
        step("references_submitted", "References submitted", f.submitted, false),
        step("references_accepted", "Accepted (lead created)", f.accepted, false),
        step("site_visits_verified", "Site visit verified", f.site_visits_verified, true),
        step("bookings_confirmed", "Booking confirmed", f.bookings_confirmed, true),
      ];
      return {
        rows,
        total: rows.length,
        summary: {
          note: "Cohort: range me submit hui references ka ab tak ka progress",
          references_rejected: f.rejected,
          leads_lost_or_closed: f.leads_lost_or_closed,
        },
      };
    },
  },
};

export async function runReportService(key, query) {
  const def = REPORTS[key];
  const { range, applied } = parseRange(query);
  const filters = def.parseFilters(query);

  const format = query.format === undefined || query.format === "" ? "json" : String(query.format).toLowerCase();
  if (!["json", "csv"].includes(format)) throw httpError(400, "format must be json or csv");

  // ---------- CSV: pagination nahi, cap ke saath
  if (format === "csv") {
    const result = await def.fetch({ range, filters, limit: MAX_CSV_ROWS + 1, offset: 0 });
    if (result.rows.length > MAX_CSV_ROWS) {
      throw httpError(400, `CSV export is limited to ${MAX_CSV_ROWS} rows. Narrow the date range or add filters`);
    }
    const stamp = applied ? `${applied.from || "start"}_to_${applied.to || "today"}` : "all";
    return {
      csv: {
        filename: `${key.replace(/-/g, "_")}_${stamp}.csv`,
        columns: COLUMNS[key],
        rows: result.rows,
      },
    };
  }

  // ---------- JSON
  const base = { report: key, range: applied };
  if (def.paged === false) {
    const result = await def.fetch({ range, filters });
    return { json: { ...base, summary: result.summary, items: result.rows } };
  }

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const result = await def.fetch({ range, filters, limit, offset: (page - 1) * limit });
  return {
    json: {
      ...base,
      summary: result.summary ?? null,
      items: result.rows,
      pagination: { page, limit, total: result.total, total_pages: Math.ceil(result.total / limit) },
    },
  };
}