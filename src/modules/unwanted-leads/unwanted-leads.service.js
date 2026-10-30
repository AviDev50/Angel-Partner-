import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import {
  parseCustomerFields,
  optionalString,
} from "../../utils/customerFields.js";
import * as model from "./unwanted-leads.model.js";
import { notifyPartner, NOTIFY } from "../../utils/notify.js";


// partner ko sirf customer details; admin/assignment internals nahi
function toPartnerView(l) {
  return {
    unwanted_lead_id: l.unwanted_lead_id,
    customer_name: l.customer_name,
    customer_mobile: l.customer_mobile,
    customer_email: l.customer_email,
    preferred_bhk: l.preferred_bhk,
    customer_budget: l.customer_budget,
    preferred_project_location: l.preferred_project_location,
    remarks: l.remarks,
    assigned_at: l.assigned_at,
    created_at: l.created_at,
    updated_at: l.updated_at,
  };
}

function viewFor(user, lead) {
  return user.role === "admin" ? lead : toPartnerView(lead);
}

export async function createUnwantedLeadService(user, body) {
  const fields = parseCustomerFields(body);
  const id = await model.insertUnwantedLead({
    ...fields,
    created_by: user.user_id,
  });
  return model.getUnwantedLeadById(id);
}

export async function listUnwantedLeadsService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.q && String(query.q).trim()) filters.q = String(query.q).trim();

  if (user.role === "partner") {
    filters.partnerId = user.user_id; // hamesha sirf apni assigned
  } else {
    if (query.unassigned === "true") filters.unassigned = true;
    if (query.assigned_to) {
      const pid = parsePositiveInt(query.assigned_to);
      if (!pid) throw httpError(400, "Invalid assigned_to");
      filters.partnerId = pid;
    }
  }

  const { rows, total } = await model.listUnwantedLeads(filters);

  return {
    items: rows.map((l) => viewFor(user, l)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getUnwantedLeadService(user, idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid unwanted lead id");

  const lead = await model.getUnwantedLeadById(id);
  // dusre partner ki / unassigned => 404 (existence leak nahi)
  if (!lead || (user.role === "partner" && lead.partner_id !== user.user_id)) {
    throw httpError(404, "Unwanted lead not found");
  }
  return viewFor(user, lead);
}

export async function assignUnwantedLeadService(user, idParam, body) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid unwanted lead id");

  const partnerId = parsePositiveInt(body.partner_id);
  if (!partnerId) throw httpError(400, "partner_id is required");
  const remarks = optionalString(body.remarks, 500, "remarks");

  await withTransaction(async (conn) => {
    const lead = await model.getUnwantedLeadForUpdate(id, conn);
    if (!lead) throw httpError(404, "Unwanted lead not found");

    const partner = await model.getActivePartner(partnerId, conn);
    if (!partner) throw httpError(400, "partner_id must be an active partner");

    if (lead.partner_id === partnerId) {
      throw httpError(409, "Unwanted lead is already assigned to this partner");
    }

    await model.assignToPartner(id, partnerId, user.user_id, remarks, conn);

    // history: reassign pe purana partner overwrite hota hai, isliye audit_logs mein rakha
    await model.addAuditLog(
      {
        user_id: user.user_id,
        action: "unwanted_lead.assigned",
        entity_id: id,
        old_values: { partner_id: lead.partner_id },
        new_values: { partner_id: partnerId },
      },
      conn,
    );

await notifyPartner(conn, {
  partnerId,
  type: NOTIFY.UNWANTED_LEAD_ASSIGNED,
  title: "New lead assigned",
  message: `Lead ${lead.customer_name} (${lead.customer_mobile}) has been assigned to you.`,
  entityType: "unwanted_lead",
  entityId: id,
});
  });

  return model.getUnwantedLeadById(id);
}
