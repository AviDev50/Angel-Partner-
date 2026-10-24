import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import { parseFutureDateTime } from "../../utils/dates.js";
import * as model from "./site-visits.model.js";
import * as leadModel from "../leads/leads.model.js";
import * as referenceModel from "../references/references.model.js";

const VISIT_STATUSES = [
  "scheduled",
  "completed",
  "verified",
  "rejected",
  "cancelled",
];
const LEAD_LOCKED = ["converted", "lost", "closed"];
const MAX_POINTS = 1000000;

// sales ko partner info / points nahi dikhane
function viewFor(user, visit) {
  if (user.role === "admin") return visit;
  const { partner_id, partner_name, points_credited, ...rest } = visit;
  return rest;
}

async function setLeadStatus(lead, status, userId, remarks, conn) {
  await leadModel.updateLeadStatus(lead.lead_id, status, conn);
  await referenceModel.addStatusHistory(
    {
      entity_type: "lead",
      entity_id: lead.lead_id,
      from_status: lead.status,
      to_status: status,
      changed_by: userId,
      remarks,
    },
    conn,
  );
}

async function setReferenceStatus(ref, status, userId, remarks, conn) {
  await referenceModel.updateStatus(ref.customer_reference_id, status, conn);
  await referenceModel.addStatusHistory(
    {
      entity_type: "customer_reference",
      entity_id: ref.customer_reference_id,
      from_status: ref.status,
      to_status: status,
      changed_by: userId,
      remarks,
    },
    conn,
  );
}

function visitHistory(visit, from, to, userId, remarks, conn) {
  return referenceModel.addStatusHistory(
    {
      entity_type: "site_visit",
      entity_id: visit.site_visit_id,
      from_status: from,
      to_status: to,
      changed_by: userId,
      remarks,
    },
    conn,
  );
}

// Lock order hamesha: lead -> visit (-> wallet). Isse schedule / complete / verify ek saath chalein to deadlock nahi hota.
async function lockVisit(user, idParam, conn) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid site visit id");

  const preview = await model.getVisitById(id, conn);
  if (!preview) throw httpError(404, "Site visit not found");

  const lead = await leadModel.getLeadForUpdate(preview.lead_id, conn);
  if (!lead) throw httpError(404, "Site visit not found");

  if (user.role === "sales_team") {
    const mine = await leadModel.isActiveSalesAssignee(
      lead.lead_id,
      user.user_id,
      conn,
    );
    if (!mine) throw httpError(404, "Site visit not found");
  }

  const visit = await model.getVisitForUpdate(id, conn);
  return { lead, visit };
}

// ---------------------------------------------------------------- schedule
export async function scheduleSiteVisitService(user, body) {
  const leadId = parsePositiveInt(body.lead_id);
  if (!leadId) throw httpError(400, "lead_id is required");

  const scheduledAt = parseFutureDateTime(body.scheduled_at, "scheduled_at");
  const projectName = optionalString(body.project_name, 255, "project_name");

  const visitId = await withTransaction(async (conn) => {
    const lead = await leadModel.getLeadForUpdate(leadId, conn);
    if (!lead) throw httpError(404, "Lead not found");

    if (user.role === "sales_team") {
      const mine = await leadModel.isActiveSalesAssignee(
        leadId,
        user.user_id,
        conn,
      );
      if (!mine) throw httpError(404, "Lead not found");
    }

    if (LEAD_LOCKED.includes(lead.status)) {
      throw httpError(
        409,
        `Lead is '${lead.status}' and a site visit cannot be scheduled`,
      );
    }
    if (await model.findOpenVisit(leadId, conn)) {
      throw httpError(
        409,
        "This lead already has an open site visit (scheduled or awaiting verification)",
      );
    }

    const id = await model.insertVisit(
      {
        lead_id: leadId,
        partner_id: lead.source_partner_id, // points isi partner ko jayenge
        scheduled_by: user.user_id,
        project_name: projectName,
        scheduled_at: scheduledAt, // db.js timezone "Z" => UTC mein store
      },
      conn,
    );

    await visitHistory(
      { site_visit_id: id },
      null,
      "scheduled",
      user.user_id,
      null,
      conn,
    );
    await setLeadStatus(
      lead,
      "site_visit_scheduled",
      user.user_id,
      `Site visit #${id} scheduled`,
      conn,
    );

    const ref = await referenceModel.getReferenceForUpdate(
      lead.customer_reference_id,
      conn,
    );
    if (
      ref &&
      !["converted", "closed", "site_visit_scheduled"].includes(ref.status)
    ) {
      await setReferenceStatus(
        ref,
        "site_visit_scheduled",
        user.user_id,
        `Site visit #${id} scheduled`,
        conn,
      );
    }

    return id;
  });

  return viewFor(user, await model.getVisitById(visitId));
}

// ---------------------------------------------------------------- list / detail
export async function listSiteVisitsService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.visit_status) {
    if (!VISIT_STATUSES.includes(query.visit_status))
      throw httpError(400, "Invalid status filter");
    filters.visitStatus = query.visit_status;
  }
  if (query.lead_id) {
    const lid = parsePositiveInt(query.lead_id);
    if (!lid) throw httpError(400, "Invalid lead_id");
    filters.leadId = lid;
  }

  if (user.role === "sales_team") {
    filters.salesUserId = user.user_id; // sirf apni assigned leads ke visits
  } else if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const { rows, total } = await model.listVisits(filters);

  return {
    items: rows.map((v) => viewFor(user, v)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getSiteVisitService(user, idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid site visit id");

  const visit = await model.getVisitById(id);
  if (
    !visit ||
    (user.role === "sales_team" && visit.sales_user_id !== user.user_id)
  ) {
    throw httpError(404, "Site visit not found");
  }

  const history = await model.getStatusHistory(id);
  return { ...viewFor(user, visit), status_history: history };
}

// ---------------------------------------------------------------- complete
export async function completeSiteVisitService(user, idParam, body) {
  const remarks = optionalString(body.visit_remarks, 5000, "visit_remarks");
  if (!remarks)
    throw httpError(400, "visit_remarks (completion details) are required");

  const id = await withTransaction(async (conn) => {
    const { lead, visit } = await lockVisit(user, idParam, conn);
    if (visit.visit_status !== "scheduled") {
      throw httpError(
        409,
        `Site visit is '${visit.visit_status}' and cannot be completed`,
      );
    }

    await model.markCompleted(visit.site_visit_id, remarks, conn);
    await visitHistory(
      visit,
      "scheduled",
      "completed",
      user.user_id,
      remarks,
      conn,
    );
    await setLeadStatus(
      lead,
      "site_visit_completed",
      user.user_id,
      `Site visit #${visit.site_visit_id} submitted for verification`,
      conn,
    );

    const ref = await referenceModel.getReferenceForUpdate(
      lead.customer_reference_id,
      conn,
    );
    if (
      ref &&
      !["converted", "closed", "site_visit_completed"].includes(ref.status)
    ) {
      await setReferenceStatus(
        ref,
        "site_visit_completed",
        user.user_id,
        `Site visit #${visit.site_visit_id} submitted for verification`,
        conn,
      );
    }

    return visit.site_visit_id;
  });

  return viewFor(user, await model.getVisitById(id));
}
// ---------------------------------------------------------------- cancel
export async function cancelSiteVisitService(user, idParam, body) {
  const remarks = optionalString(body.remarks, 500, "remarks");

  const id = await withTransaction(async (conn) => {
    const { lead, visit } = await lockVisit(user, idParam, conn);
    if (visit.visit_status !== "scheduled") {
      throw httpError(
        409,
        `Site visit is '${visit.visit_status}' and cannot be cancelled`,
      );
    }

    await model.markCancelled(visit.site_visit_id, conn);
    await visitHistory(
      visit,
      "scheduled",
      "cancelled",
      user.user_id,
      remarks,
      conn,
    );

    // lead / reference ko visit schedule hone se pehle wale status pe wapas
    if (lead.status === "site_visit_scheduled") {
      const prev = await model.getPreviousStatus(
        "lead",
        lead.lead_id,
        "site_visit_scheduled",
        conn,
      );
      if (prev)
        await setLeadStatus(
          lead,
          prev,
          user.user_id,
          `Site visit #${visit.site_visit_id} cancelled`,
          conn,
        );
    }

    const ref = await referenceModel.getReferenceForUpdate(
      lead.customer_reference_id,
      conn,
    );
    if (ref && ref.status === "site_visit_scheduled") {
      const prev = await model.getPreviousStatus(
        "customer_reference",
        ref.customer_reference_id,
        "site_visit_scheduled",
        conn,
      );
      if (prev)
        await setReferenceStatus(
          ref,
          prev,
          user.user_id,
          `Site visit #${visit.site_visit_id} cancelled`,
          conn,
        );
    }

    return visit.site_visit_id;
  });

  return viewFor(user, await model.getVisitById(id));
}

// ---------------------------------------------------------------- verify (admin) + points credit
// ---------------------------------------------------------------- verify (admin) + custom points credit
async function creditPoints(visit, points, adminId, conn) {
  await model.ensureWallet(visit.partner_id, conn);
  const wallet = await model.getWalletForUpdate(visit.partner_id, conn);
  const newBalance = wallet.points_balance + points;

  await model.insertPointsCredit(
    {
      partner_id: visit.partner_id,
      site_visit_id: visit.site_visit_id,
      points,
      balance_after: newBalance,
      reason: `Site visit #${visit.site_visit_id} verified`,
      performed_by: adminId,
    },
    conn,
  );
  await model.setWalletBalance(wallet.partner_wallet_id, newBalance, conn);

  await model.createNotification(
    {
      user_id: visit.partner_id,
      type: "point_credited",
      title: "Points credited",
      message: `${points} points credited for a verified site visit.`,
      entity_type: "site_visit",
      entity_id: visit.site_visit_id,
    },
    conn,
  );
}

export async function verifySiteVisitService(user, idParam, body) {
  const decision = String(body.decision || "").trim();
  if (!["verified", "rejected"].includes(decision)) {
    throw httpError(400, "decision must be 'verified' or 'rejected'");
  }
  const remarks = optionalString(
    body.verification_remarks,
    500,
    "verification_remarks",
  );
  if (decision === "rejected" && !remarks) {
    throw httpError(400, "verification_remarks are required when rejecting");
  }

  const hasPoints =
    body.points !== undefined && body.points !== null && body.points !== "";
  let points = null;
  if (decision === "rejected") {
    if (hasPoints)
      throw httpError(400, "points are not allowed when rejecting");
  } else if (hasPoints) {
    points = parsePositiveInt(body.points);
    if (!points || points > MAX_POINTS) {
      throw httpError(
        400,
        `points must be a positive integer (max ${MAX_POINTS})`,
      );
    }
  }

  const id = await withTransaction(async (conn) => {
    const { visit } = await lockVisit(user, idParam, conn);
    if (visit.visit_status !== "completed") {
      throw httpError(
        409,
        `Site visit is '${visit.visit_status}' and cannot be verified`,
      );
    }

    // partner wali visit verify karte time points dena zaroori hai
    if (decision === "verified" && visit.partner_id && !points) {
      throw httpError(
        400,
        "points are required when verifying this site visit",
      );
    }

    await model.markVerification(
      visit.site_visit_id,
      decision,
      user.user_id,
      remarks,
      conn,
    );
    await visitHistory(
      visit,
      "completed",
      decision,
      user.user_id,
      remarks,
      conn,
    );

    if (decision === "verified" && visit.partner_id) {
      await creditPoints(visit, points, user.user_id, conn);
    }

    return visit.site_visit_id;
  });

  return model.getVisitById(id);
}
