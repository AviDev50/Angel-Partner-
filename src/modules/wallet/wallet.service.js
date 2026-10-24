import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import * as model from "./wallet.model.js";

const TYPES = ["site_visit_credit", "redemption_debit", "reversal", "correction"];

async function summary(partnerId) {
  const wallet = await model.getWallet(partnerId);
  const totals = await model.getTotals(partnerId);
  return {
    points_balance: wallet ? wallet.points_balance : 0,
    total_earned: Number(totals.earned),
    total_spent: Number(totals.spent),
  };
}

export async function getWalletService(partnerId) {
  return summary(partnerId);
}

export async function getPartnerWalletService(idParam) {
  const partnerId = parsePositiveInt(idParam);
  if (!partnerId) throw httpError(400, "Invalid partner id");
  const partner = await model.getPartner(partnerId);
  if (!partner) throw httpError(404, "Partner not found");
  return { partner_id: partner.user_id, partner_name: partner.full_name, ...(await summary(partnerId)) };
}

// partner ko admin ka naam / partner info nahi dikhana
function viewFor(user, row) {
  if (user.role === "admin") return row;
  const { performed_by_name, partner_name, partner_id, ...rest } = row;
  return rest;
}

export async function listTransactionsService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.transaction_type) {
    if (!TYPES.includes(query.transaction_type)) throw httpError(400, "Invalid transaction_type filter");
    filters.type = query.transaction_type;
  }
  if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listTransactions(filters);
  return {
    items: rows.map((r) => viewFor(user, r)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function listPartnerTransactionsService(user, idParam, query) {
  const partnerId = parsePositiveInt(idParam);
  if (!partnerId) throw httpError(400, "Invalid partner id");
  const partner = await model.getPartner(partnerId);
  if (!partner) throw httpError(404, "Partner not found");
  return listTransactionsService(user, { ...query, partner_id: partnerId });
}