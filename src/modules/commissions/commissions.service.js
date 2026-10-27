import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import { parseDateOnly } from "../../utils/dateOnly.js";
import * as model from "./commissions.model.js";
import * as referenceModel from "../references/references.model.js";
import { notifyPartner, NOTIFY } from "../../utils/notify.js";

const COMMISSION_STATUSES = [
  "pending_eligibility",
  "generated",
  "approved",
  "payment_processing",
  "paid",
  "cancelled",
];

// ---------------------------------------------------------------- list / detail (admin)
export async function listCommissionsService(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.commission_status) {
    if (!COMMISSION_STATUSES.includes(query.commission_status)) throw httpError(400, "Invalid status filter");
    filters.status = query.commission_status;
  }
  if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listCommissions(filters);
  return { items: rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
}

export async function getCommissionService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid commission id");

  const commission = await model.getCommissionById(id);
  if (!commission) throw httpError(404, "Commission not found");

  const statusHistory = await model.getStatusHistory(id);
  return { ...commission, status_history: statusHistory };
}

// ---------------------------------------------------------------- mark paid (admin)
export async function markPaidService(user, idParam, body) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid commission id");

  const paymentDate = parseDateOnly(body.payment_date, "payment_date", { defaultToday: true });
  const paymentDetails = optionalString(body.payment_details, 500, "payment_details");
  if (!paymentDetails) throw httpError(400, "payment_details are required");
  const remarks = optionalString(body.remarks, 500, "remarks");

  await withTransaction(async (conn) => {
    const commission = await model.getCommissionForUpdate(id, conn); // row lock => double pay nahi
    if (!commission) throw httpError(404, "Commission not found");
    if (commission.commission_status !== "approved") {
      throw httpError(409, `Commission is '${commission.commission_status}' and cannot be marked as paid`);
    }

    await model.markPaid(id, paymentDate, paymentDetails, remarks, conn);
    await referenceModel.addStatusHistory(
      {
        entity_type: "commission",
        entity_id: id,
        from_status: "approved",
        to_status: "paid",
        changed_by: user.user_id,
        remarks,
      },
      conn,
    );

    await model.createNotification(
      {
        user_id: commission.partner_id,
        type: "commission_paid",
        title: "Commission paid",
        message: `Commission of Rs. ${commission.commission_amount} for ${commission.project_name} has been paid.`,
        entity_type: "commission",
        entity_id: id,
      },
      conn,
    );
  });

  return getCommissionService(id);
}