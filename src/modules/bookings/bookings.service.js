import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import { parseDateOnly } from "../../utils/dateOnly.js";
import * as model from "./bookings.model.js";
import * as commissionModel from "../commissions/commissions.model.js";
import * as leadModel from "../leads/leads.model.js";
import * as referenceModel from "../references/references.model.js";

const BOOKING_STATUSES = ["pending_verification", "booked", "rejected", "cancelled"];
const SUBMITTABLE_LEAD_STATUSES = ["site_visit_completed", "booking_in_progress"];
const LEAD_LOCKED = ["converted", "lost", "closed"];
const MAX_COMMISSION = 100000000;

// sales ko partner info / commission nahi dikhani
function viewFor(user, booking) {
  if (user.role === "admin") return booking;
  const { partner_id, partner_name, commission_id, commission_amount, commission_status, ...rest } = booking;
  return rest;
}

function parseCommissionAmount(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) {
    throw httpError(400, "commission_amount must be a positive number with up to 2 decimals");
  }
  const n = Number(raw);
  if (n <= 0 || n > MAX_COMMISSION) {
    throw httpError(400, `commission_amount must be between 0.01 and ${MAX_COMMISSION}`);
  }
  return n.toFixed(2);
}

function history(entityType, entityId, from, to, userId, remarks, conn) {
  return referenceModel.addStatusHistory(
    {
      entity_type: entityType,
      entity_id: entityId,
      from_status: from,
      to_status: to,
      changed_by: userId,
      remarks,
    },
    conn,
  );
}

async function setLeadStatus(lead, status, userId, remarks, conn) {
  await leadModel.updateLeadStatus(lead.lead_id, status, conn);
  await history("lead", lead.lead_id, lead.status, status, userId, remarks, conn);
}

async function setReferenceStatus(ref, status, userId, remarks, conn) {
  await referenceModel.updateStatus(ref.customer_reference_id, status, conn);
  await history("customer_reference", ref.customer_reference_id, ref.status, status, userId, remarks, conn);
}

// Lock order hamesha: lead -> booking (-> commission)
async function lockBooking(idParam, conn) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid booking id");

  const preview = await model.getBookingById(id, conn);
  if (!preview) throw httpError(404, "Booking not found");

  const lead = await leadModel.getLeadForUpdate(preview.lead_id, conn);
  if (!lead) throw httpError(404, "Booking not found");

  const booking = await model.getBookingForUpdate(id, conn);
  return { lead, booking };
}

// ---------------------------------------------------------------- submit (sales / admin)
export async function createBookingService(user, body) {
  const leadId = parsePositiveInt(body.lead_id);
  if (!leadId) throw httpError(400, "lead_id is required");

  const projectName = optionalString(body.project_name, 255, "project_name");
  if (!projectName) throw httpError(400, "project_name is required");
  const bookingDate = parseDateOnly(body.booking_date, "booking_date");
  const remarks = optionalString(body.remarks, 5000, "remarks");

  const id = await withTransaction(async (conn) => {
    const lead = await leadModel.getLeadForUpdate(leadId, conn);
    if (!lead) throw httpError(404, "Lead not found");

    if (user.role === "sales_team") {
      const mine = await leadModel.isActiveSalesAssignee(leadId, user.user_id, conn);
      if (!mine) throw httpError(404, "Lead not found");
    }

    if (!lead.source_partner_id) {
      throw httpError(409, "Bookings are only allowed for partner reference leads");
    }
    if (!SUBMITTABLE_LEAD_STATUSES.includes(lead.status)) {
      throw httpError(409, `Lead is '${lead.status}' and a booking cannot be submitted`);
    }
    if (await model.findOpenBooking(leadId, conn)) {
      throw httpError(409, "This lead already has a booking awaiting verification");
    }

    const bookingId = await model.insertBooking(
      {
        lead_id: leadId,
        partner_id: lead.source_partner_id,
        project_name: projectName,
        booking_date: bookingDate,
        remarks,
        recorded_by: user.user_id,
      },
      conn,
    );

    await history("booking", bookingId, null, "pending_verification", user.user_id, null, conn);

    if (lead.status !== "booking_in_progress") {
      await setLeadStatus(lead, "booking_in_progress", user.user_id, `Booking #${bookingId} submitted for verification`, conn);
    }
    return bookingId;
  });

  return viewFor(user, await model.getBookingById(id));
}

// ---------------------------------------------------------------- list / detail
export async function listBookingsService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.booking_status) {
    if (!BOOKING_STATUSES.includes(query.booking_status)) throw httpError(400, "Invalid status filter");
    filters.bookingStatus = query.booking_status;
  }
  if (query.lead_id) {
    const lid = parsePositiveInt(query.lead_id);
    if (!lid) throw httpError(400, "Invalid lead_id");
    filters.leadId = lid;
  }

  if (user.role === "sales_team") {
    filters.salesUserId = user.user_id; // sirf apni assigned leads ki bookings
  } else if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listBookings(filters);
  return {
    items: rows.map((b) => viewFor(user, b)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getBookingService(user, idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid booking id");

  const booking = await model.getBookingById(id);
  if (!booking || (user.role === "sales_team" && booking.sales_user_id !== user.user_id)) {
    throw httpError(404, "Booking not found");
  }

  const statusHistory = await model.getStatusHistory(id);
  return { ...viewFor(user, booking), status_history: statusHistory };
}

// ---------------------------------------------------------------- verify (admin) + custom commission
export async function verifyBookingService(user, idParam, body) {
  const decision = String(body.decision || "").trim();
  if (!["verified", "rejected"].includes(decision)) {
    throw httpError(400, "decision must be 'verified' or 'rejected'");
  }
  const remarks = optionalString(body.verification_remarks, 500, "verification_remarks");
  if (decision === "rejected" && !remarks) {
    throw httpError(400, "verification_remarks are required when rejecting");
  }

  const hasAmount =
    body.commission_amount !== undefined && body.commission_amount !== null && body.commission_amount !== "";
  let amount = null;
  if (decision === "rejected") {
    if (hasAmount) throw httpError(400, "commission_amount is not allowed when rejecting");
  } else {
    if (!hasAmount) throw httpError(400, "commission_amount is required when verifying");
    amount = parseCommissionAmount(body.commission_amount);
  }

  const id = await withTransaction(async (conn) => {
    const { lead, booking } = await lockBooking(idParam, conn);
    if (booking.booking_status !== "pending_verification") {
      throw httpError(409, `Booking is '${booking.booking_status}' and cannot be verified`);
    }

    const newStatus = decision === "verified" ? "booked" : "rejected";

    if (decision === "verified") {
      // submit aur verify ke beech lead lost/closed ho gayi ho to convert nahi karenge
      if (LEAD_LOCKED.includes(lead.status)) {
        throw httpError(409, `Lead is '${lead.status}' and this booking cannot be verified`);
      }
      if (!booking.partner_id) {
        throw httpError(409, "Booking has no partner; commission cannot be created");
      }
    }

    await model.markVerification(booking.booking_id, newStatus, user.user_id, remarks, conn);
    await history("booking", booking.booking_id, "pending_verification", newStatus, user.user_id, remarks, conn);

    if (decision === "verified") {
      await setLeadStatus(lead, "converted", user.user_id, `Booking #${booking.booking_id} verified`, conn);

      const ref = await referenceModel.getReferenceForUpdate(lead.customer_reference_id, conn);
      if (ref && !["converted", "closed"].includes(ref.status)) {
        await setReferenceStatus(ref, "converted", user.user_id, `Booking #${booking.booking_id} verified`, conn);
      }

      const commissionId = await commissionModel.insertCommissionFromBooking(
        booking.booking_id,
        amount,
        user.user_id,
        conn,
      );
      await history("commission", commissionId, null, "approved", user.user_id, null, conn);

      await model.createNotification(
        {
          user_id: booking.partner_id,
          type: "booking_confirmed",
          title: "Booking confirmed",
          message: `Booking confirmed for ${booking.project_name}. Commission of Rs. ${amount} has been added.`,
          entity_type: "booking",
          entity_id: booking.booking_id,
        },
        conn,
      );
    }

    // submit karne wale (sales) ko result batao
    if (booking.recorded_by !== user.user_id) {
      await model.createNotification(
        {
          user_id: booking.recorded_by,
          type: decision === "verified" ? "booking_verified" : "booking_rejected",
          title: decision === "verified" ? "Booking verified" : "Booking rejected",
          message:
            decision === "verified"
              ? `Booking #${booking.booking_id} for ${booking.project_name} was verified.`
              : `Booking #${booking.booking_id} for ${booking.project_name} was rejected: ${remarks}`.slice(0, 1000),
          entity_type: "booking",
          entity_id: booking.booking_id,
        },
        conn,
      );
    }

    return booking.booking_id;
  });

  return model.getBookingById(id);
}