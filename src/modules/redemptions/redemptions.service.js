import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import * as model from "./redemptions.model.js";
import * as walletModel from "../wallet/wallet.model.js";
import * as referenceModel from "../references/references.model.js";

const MAX_POINTS = 1000000;

function parseRedemptionDate(value) {
  const today = new Date().toISOString().slice(0, 10);
  if (value === undefined || value === null || value === "") return today;
  const raw = String(value).trim();
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    throw httpError(400, "redemption_date must be YYYY-MM-DD");
  }
  if (raw > today) throw httpError(400, "redemption_date cannot be in the future");
  return raw;
}

// ---------------------------------------------------------------- create (admin)
export async function createRedemptionService(user, body) {
  const partnerId = parsePositiveInt(body.partner_id);
  if (!partnerId) throw httpError(400, "partner_id is required");

  const points = parsePositiveInt(body.points_redeemed);
  if (!points || points > MAX_POINTS) {
    throw httpError(400, `points_redeemed must be a positive integer (max ${MAX_POINTS})`);
  }
  const reward = optionalString(body.reward_description, 255, "reward_description");
  if (!reward) throw httpError(400, "reward_description is required");
  const remarks = optionalString(body.remarks, 500, "remarks");
  const redemptionDate = parseRedemptionDate(body.redemption_date);

  const id = await withTransaction(async (conn) => {
    const partner = await walletModel.getPartner(partnerId, conn);
    if (!partner) throw httpError(404, "Partner not found");

    await walletModel.ensureWallet(partnerId, conn);
    const wallet = await walletModel.getWalletForUpdate(partnerId, conn); // row lock
    if (wallet.points_balance < points) {
      throw httpError(409, `Insufficient points balance (available ${wallet.points_balance})`);
    }
    const newBalance = wallet.points_balance - points;

    const redemptionId = await model.insertRedemption(
      {
        partner_id: partnerId,
        points_redeemed: points,
        reward_description: reward,
        redemption_date: redemptionDate,
        remarks,
        admin_id: user.user_id,
      },
      conn,
    );

    await walletModel.insertPointsDebit(
      {
        partner_id: partnerId,
        redemption_id: redemptionId,
        points,
        balance_after: newBalance,
        reason: `Withdrawal #${redemptionId}: ${reward}`.slice(0, 500),
        performed_by: user.user_id,
      },
      conn,
    );
    await walletModel.setWalletBalance(wallet.partner_wallet_id, newBalance, conn);

    await referenceModel.addStatusHistory(
      {
        entity_type: "redemption",
        entity_id: redemptionId,
        from_status: null,
        to_status: "redeemed",
        changed_by: user.user_id,
        remarks,
      },
      conn,
    );

  await notifyPartner(conn, {
  partnerId,
  type: NOTIFY.POINTS_WITHDRAWN,
  title: "Points withdrawn",
  message: `${points} points were deducted for a withdrawal.`,
  entityType: "redemption",
  entityId: redemptionId,
});

    return redemptionId;
  });

  return model.getRedemptionById(id);
}

// ---------------------------------------------------------------- list / detail (admin)
export async function listRedemptionsService(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listRedemptions(filters);
  return { items: rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
}

export async function getRedemptionService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid redemption id");

  const r = await model.getRedemptionById(id);
  if (!r) throw httpError(404, "Redemption not found");
  return r;
}