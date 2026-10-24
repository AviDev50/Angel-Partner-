import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import * as model from "./wallet.model.js";

const TX_TYPES = ["site_visit_credit", "redemption_debit", "reversal", "correction"];
const COMMISSION_STATUSES = [
  "pending_eligibility",
  "generated",
  "approved",
  "payment_processing",
  "paid",
  "cancelled",
];

function pagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit };
}

async function requirePartner(idParam) {
  const partnerId = parsePositiveInt(idParam);
  if (!partnerId) throw httpError(400, "Invalid partner id");
  const partner = await model.getPartner(partnerId);
  if (!partner) throw httpError(404, "Partner not found");
  return partner;
}

// ---------------------------------------------------------------- summary
async function summary(partnerId) {
  const [wallet, pts, com] = await Promise.all([
    model.getWallet(partnerId),
    model.getPointsTotals(partnerId),
    model.getCommissionTotals(partnerId),
  ]);
  const paid = Number(com.paid);
  const pending = Number(com.pending);
  return {
    points: {
      balance: wallet ? wallet.points_balance : 0,
      total_earned: Number(pts.earned),
      total_withdrawn: Number(pts.withdrawn),
    },
    commission: { total: paid + pending, paid, pending },
  };
}

export async function getWalletService(partnerId) {
  return summary(partnerId);
}

export async function getPartnerWalletService(idParam) {
  const partner = await requirePartner(idParam);
  return { partner_id: partner.user_id, partner_name: partner.full_name, ...(await summary(partner.user_id)) };
}

// ---------------------------------------------------------------- points ledger
function txView(user, row) {
  if (user.role === "admin") return row;
  const { performed_by_name, partner_name, partner_id, ...rest } = row;
  return rest;
}

export async function listTransactionsService(user, query) {
  const { page, limit } = pagination(query);
  const filters = { page, limit };

  if (query.transaction_type) {
    if (!TX_TYPES.includes(query.transaction_type)) throw httpError(400, "Invalid transaction_type filter");
    filters.type = query.transaction_type;
  }
  if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listTransactions(filters);
  return {
    items: rows.map((r) => txView(user, r)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listPartnerTransactionsService(user, idParam, query) {
  const partner = await requirePartner(idParam);
  return listTransactionsService(user, { ...query, partner_id: partner.user_id });
}

// ---------------------------------------------------------------- commissions
function commissionView(user, row) {
  if (user.role === "admin") return row;
  const { payment_details, remarks, partner_id, ...rest } = row;
  return rest;
}

export async function listCommissionsService(user, query) {
  const { page, limit } = pagination(query);
  const filters = { page, limit, partnerId: parsePositiveInt(query.partner_id) };

  if (query.commission_status) {
    if (!COMMISSION_STATUSES.includes(query.commission_status)) {
      throw httpError(400, "Invalid commission_status filter");
    }
    filters.status = query.commission_status;
  }

  const { rows, total } = await model.listCommissions(filters);
  return {
    items: rows.map((r) => commissionView(user, r)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listPartnerCommissionsService(user, idParam, query) {
  const partner = await requirePartner(idParam);
  return listCommissionsService(user, { ...query, partner_id: partner.user_id });
}