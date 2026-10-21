import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { parseCustomerFields, optionalString } from "../../utils/customerFields.js";
import * as leadModel from "./leads.model.js";
import * as referenceModel from "../references/references.model.js";

const LEAD_STATUSES = [
  "new", "contacted", "follow_up_required", "site_visit_scheduled", "site_visit_completed",
  "booking_in_progress", "converted", "lost", "closed",
];
const LEAD_SOURCES = ["partner_reference", "admin_created", "admin_imported"];

// Sales/admin manually sirf yahi set kar sakte hain.
// site_visit_* aur converted baaki modules (site visits / bookings) set karenge.
const MANUAL_STATUSES = ["contacted", "follow_up_required", "booking_in_progress", "lost", "closed"];

// Terminal: inke baad na status badlega na reassign hoga
const LOCKED_STATUSES = ["converted", "lost", "closed"];

// lead status -> partner ko dikhne wala reference status
const REFERENCE_SYNC = {
  contacted: "in_progress",
  follow_up_required: "in_progress",
  booking_in_progress: "in_progress",
  lost: "closed",
  closed: "closed",
};

function nextReferenceStatus(refStatus, leadStatus) {
  const target = REFERENCE_SYNC[leadStatus];
  if (!target || refStatus === target) return null;
  if (["converted", "closed"].includes(refStatus)) return null;
  // reference aage badh chuka ho (site visit etc.) to peeche mat le jao
  if (target === "in_progress" && !["accepted", "assigned_to_sales_team"].includes(refStatus)) return null;
  return target;
}

// sales ko partner ki info nahi dikhani
function viewFor(user, lead) {
  if (user.role === "admin") return lead;
  const { source_partner_id, source_partner_name, ...rest } = lead;
  return rest;
}

// admin: koi bhi lead; sales: sirf apni active assigned lead (warna 404, existence leak nahi)
async function loadAccessibleLead(user, idParam) {
  const leadId = parsePositiveInt(idParam);
  if (!leadId) throw httpError(400, "Invalid lead id");

  const lead = await leadModel.getLeadById(leadId);
  if (!lead || (user.role === "sales_team" && lead.sales_user_id !== user.user_id)) {
    throw httpError(404, "Lead not found");
  }
  return lead;
}

// ---------------------------------------------------------------- create (admin)
export async function createLeadService(user, body) {
  const fields = parseCustomerFields(body);

  const leadId = await withTransaction(async (conn) => {
    const id = await leadModel.insertLead({ ...fields, created_by: user.user_id }, conn);
    await referenceModel.addStatusHistory(
      {
        entity_type: "lead",
        entity_id: id,
        from_status: null,
        to_status: "new",
        changed_by: user.user_id,
        remarks: "Created by admin",
      },
      conn,
    );
    return id;
  });

  return leadModel.getLeadById(leadId);
}

// ---------------------------------------------------------------- list
export async function listLeadsService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.status) {
    if (!LEAD_STATUSES.includes(query.status)) throw httpError(400, "Invalid status filter");
    filters.status = query.status;
  }
  if (query.q && String(query.q).trim()) filters.q = String(query.q).trim();

  if (user.role === "sales_team") {
    filters.salesUserId = user.user_id; // hamesha sirf apni
  } else {
    if (query.lead_source) {
      if (!LEAD_SOURCES.includes(query.lead_source)) throw httpError(400, "Invalid lead_source filter");
      filters.leadSource = query.lead_source;
    }
    if (query.unassigned === "true") filters.unassigned = true;
    if (query.assigned_to) {
      const uid = parsePositiveInt(query.assigned_to);
      if (!uid) throw httpError(400, "Invalid assigned_to");
      filters.salesUserId = uid;
    }
  }

  const { rows, total } = await leadModel.listLeads(filters);

  return {
    items: rows.map((l) => viewFor(user, l)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

// ---------------------------------------------------------------- detail
export async function getLeadService(user, idParam) {
  const lead = await loadAccessibleLead(user, idParam);
  const statusHistory = await leadModel.getStatusHistory(lead.lead_id);

  const data = { ...viewFor(user, lead), status_history: statusHistory };
  if (user.role === "admin") {
    data.assignment_history = await leadModel.getAssignmentHistory(lead.lead_id);
  }
  return data;
}

// ---------------------------------------------------------------- status
export async function updateLeadStatusService(user, idParam, body) {
  const leadId = parsePositiveInt(idParam);
  if (!leadId) throw httpError(400, "Invalid lead id");

  const status = String(body.status || "").trim();
  if (!LEAD_STATUSES.includes(status)) throw httpError(400, "Invalid status");
  if (!MANUAL_STATUSES.includes(status)) {
    throw httpError(400, `Status '${status}' is set automatically by the site visit / booking flow`);
  }

  const remarks = optionalString(body.remarks, 500, "remarks");
  if (status === "lost" && !remarks) throw httpError(400, "remarks are required when marking a lead as lost");

  await withTransaction(async (conn) => {
    const lead = await leadModel.getLeadForUpdate(leadId, conn);
    if (!lead) throw httpError(404, "Lead not found");

    if (user.role === "sales_team") {
      const mine = await leadModel.isActiveSalesAssignee(leadId, user.user_id, conn);
      if (!mine) throw httpError(404, "Lead not found");
    }

    if (LOCKED_STATUSES.includes(lead.status)) {
      throw httpError(409, `Lead is '${lead.status}' and can no longer be changed`);
    }
    if (lead.status === status) throw httpError(409, `Lead is already '${status}'`);

    await leadModel.updateLeadStatus(leadId, status, conn);
    await referenceModel.addStatusHistory(
      {
        entity_type: "lead",
        entity_id: leadId,
        from_status: lead.status,
        to_status: status,
        changed_by: user.user_id,
        remarks,
      },
      conn,
    );

    // partner reference ke saath status sync
    if (lead.customer_reference_id) {
      const ref = await referenceModel.getReferenceForUpdate(lead.customer_reference_id, conn);
      const next = ref && nextReferenceStatus(ref.status, status);
      if (next) {
        await referenceModel.updateStatus(ref.customer_reference_id, next, conn);
        await referenceModel.addStatusHistory(
          {
            entity_type: "customer_reference",
            entity_id: ref.customer_reference_id,
            from_status: ref.status,
            to_status: next,
            changed_by: user.user_id,
            remarks: `Lead status changed to ${status}`,
          },
          conn,
        );
      }
    }
  });

  return getLeadService(user, leadId);
}

// ---------------------------------------------------------------- assign (admin)
export async function assignLeadService(user, idParam, body) {
  const leadId = parsePositiveInt(idParam);
  if (!leadId) throw httpError(400, "Invalid lead id");

  const salesUserId = parsePositiveInt(body.sales_user_id);
  if (!salesUserId) throw httpError(400, "sales_user_id is required");
  const remarks = optionalString(body.remarks, 500, "remarks");

  await withTransaction(async (conn) => {
    // lead row lock => ek time pe ek hi active assignment
    const lead = await leadModel.getLeadForUpdate(leadId, conn);
    if (!lead) throw httpError(404, "Lead not found");
    if (LOCKED_STATUSES.includes(lead.status)) {
      throw httpError(409, `Lead is '${lead.status}' and cannot be assigned`);
    }

    const salesUser = await leadModel.getActiveSalesUser(salesUserId, conn);
    if (!salesUser) throw httpError(400, "sales_user_id must be an active sales team member");

    const current = await leadModel.getActiveSalesAssignment(leadId, conn);
    if (current && current.assigned_user_id === salesUserId) {
      throw httpError(409, "Lead is already assigned to this sales member");
    }
    if (current) await leadModel.closeAssignment(current.lead_assignment_id, conn);

    await leadModel.insertAssignment(
      { lead_id: leadId, assigned_user_id: salesUserId, assigned_by: user.user_id, remarks },
      conn,
    );

    if (lead.customer_reference_id) {
      const ref = await referenceModel.getReferenceForUpdate(lead.customer_reference_id, conn);
      if (ref && ref.status === "accepted") {
        await referenceModel.updateStatus(ref.customer_reference_id, "assigned_to_sales_team", conn);
        await referenceModel.addStatusHistory(
          {
            entity_type: "customer_reference",
            entity_id: ref.customer_reference_id,
            from_status: "accepted",
            to_status: "assigned_to_sales_team",
            changed_by: user.user_id,
            remarks: null,
          },
          conn,
        );
      }
    }

    await leadModel.createNotification(
      {
        user_id: salesUserId,
        type: "lead_assigned",
        title: "New lead assigned",
        message: `Lead ${lead.customer_name} (${lead.customer_mobile}) has been assigned to you.`,
        entity_type: "lead",
        entity_id: leadId,
      },
      conn,
    );
  });

  return getLeadService(user, leadId);
}

// ---------------------------------------------------------------- follow-ups
export async function listFollowUpsService(user, idParam) {
  const lead = await loadAccessibleLead(user, idParam);
  return leadModel.getFollowUps(lead.lead_id);
}

export async function addFollowUpService(user, idParam, body) {
  const lead = await loadAccessibleLead(user, idParam);

  const activityType = String(body.activity_type || "").trim();
  if (!["call", "note"].includes(activityType)) {
    throw httpError(400, "activity_type must be 'call' or 'note'");
  }

  const remarks = optionalString(body.remarks, 5000, "remarks");
  if (!remarks) throw httpError(400, "remarks are required");

  let nextFollowUpAt = null;
  if (body.next_follow_up_at) {
    const raw = String(body.next_follow_up_at).trim();
    // timezone ke bina parse karne pe server ka local time lag jata hai, isliye offset mandatory
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
      throw httpError(400, "next_follow_up_at must be ISO-8601 with timezone, e.g. 2026-10-25T11:30:00+05:30");
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw httpError(400, "next_follow_up_at is invalid");
    if (d.getTime() <= Date.now()) throw httpError(400, "next_follow_up_at must be in the future");
    nextFollowUpAt = d; // db.js timezone "Z" => UTC mein store hoga
  }

  const id = await leadModel.insertFollowUp({
    lead_id: lead.lead_id,
    performed_by: user.user_id,
    activity_type: activityType,
    remarks,
    next_follow_up_at: nextFollowUpAt,
  });

  return leadModel.getFollowUpById(id);
}