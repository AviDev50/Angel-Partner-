import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import {
  normalizeMobile,
  isValidEmail,
  parsePositiveInt,
} from "../../utils/validators.js";
import * as referenceModel from "./references.model.js";
import { notifyPartner, NOTIFY } from "../../utils/notify.js";
import { autoAssignLead } from "../leads/leads.service.js";

const STATUSES = [
  "submitted",
  "under_review",
  "accepted",
  "rejected",
  "assigned_to_sales_team",
  "in_progress",
  "site_visit_scheduled",
  "site_visit_completed",
  "site_visit_rejected",
  "converted",
  "closed",
];

function optionalString(value, max, field) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max)
    throw httpError(400, `${field} must be at most ${max} characters`);
  return s;
}

// partner ko duplicate flags / admin internals nahi dikhne chahiye
function toPartnerView(ref) {
  return {
    customer_reference_id: ref.customer_reference_id,
    reference_code: ref.reference_code,
    customer_name: ref.customer_name,
    customer_mobile: ref.customer_mobile,
    customer_email: ref.customer_email,
    preferred_bhk: ref.preferred_bhk,
    customer_budget: ref.customer_budget,
    preferred_project_location: ref.preferred_project_location,
    remarks: ref.remarks,
    review_remarks: ref.review_remarks,
    created_at: ref.created_at,
    updated_at: ref.updated_at,
    status: ref.expired_at ? "expired" : ref.status,
expires_at: ref.expires_at,   // Flutter "X days left" dikha sake
  };
}

function viewFor(user, ref) {
  return user.role === "admin" ? ref : toPartnerView(ref);
}

// ---------------------------------------------------------------- create
export async function createReferenceService(user, body) {
  const customerName = optionalString(body.customer_name, 150, "customer_name");
  if (!customerName) throw httpError(400, "customer_name is required");

  const mobile = normalizeMobile(body.customer_mobile);
  if (!mobile)
    throw httpError(
      400,
      "customer_mobile must be a valid 10-digit mobile number",
    );

  let email = optionalString(body.customer_email, 190, "customer_email");
  if (email) {
    email = email.toLowerCase();
    if (!isValidEmail(email)) throw httpError(400, "customer_email is invalid");
  }

  let budget = null;
  if (
    body.customer_budget !== undefined &&
    body.customer_budget !== null &&
    body.customer_budget !== ""
  ) {
    budget = Number(body.customer_budget);
    if (!Number.isFinite(budget) || budget <= 0 || budget >= 1e12) {
      throw httpError(400, "customer_budget must be a positive number");
    }
  }

  const data = {
    partner_id: user.user_id,
    customer_name: customerName,
    customer_mobile: mobile,
    customer_email: email,
    preferred_bhk: optionalString(body.preferred_bhk, 30, "preferred_bhk"),
    customer_budget: budget,
    preferred_project_location: optionalString(
      body.preferred_project_location,
      255,
      "preferred_project_location",
    ),
    remarks: optionalString(body.remarks, 5000, "remarks"),
  };

  const referenceId = await withTransaction(async (conn) => {
    // duplicate => sirf flag, kabhi reject/merge nahi
    const original = await referenceModel.findEarliestByMobile(mobile, conn);
    
// create ke transaction mein, insertReference se pehle:
const expiryDays = await referenceModel.getExpiryDays(conn);
// insertReference ke data mein: expiry_days: expiryDays
    const id = await referenceModel.insertReference(
      {
        ...data,
        is_potential_duplicate: original ? 1 : 0,
        duplicate_of_reference_id: original
          ? original.customer_reference_id
          : null,
           expiry_days: expiryDays,
      },
      conn,
    );

    const code = `REF-${new Date().getUTCFullYear()}-${String(id).padStart(6, "0")}`;
    await referenceModel.setReferenceCode(id, code, conn);

    await referenceModel.addStatusHistory(
      {
        entity_type: "customer_reference",
        entity_id: id,
        from_status: null,
        to_status: "submitted",
        changed_by: user.user_id,
        remarks: null,
      },
      conn,
    );

    await notifyPartner(conn, {
      partnerId: user.user_id,
      type: NOTIFY.REFERENCE_SUBMITTED,
      title: "Reference submitted",
      message: `Your reference ${code} for ${customerName} has been submitted.`,
      entityType: "customer_reference",
      entityId: id,
    });

    // ---- admin review ki jagah: lead auto-create + auto-assign
    const leadId = await referenceModel.createLeadFromReference(
      { customer_reference_id: id, ...data },
      user.user_id, // created_by = submit karne wala partner
      conn,
    );
    await referenceModel.addStatusHistory(
      {
        entity_type: "lead",
        entity_id: leadId,
        from_status: null,
        to_status: "new",
        changed_by: user.user_id,
        remarks: `Created from ${code}`,
      },
      conn,
    );

    const salesUserId = await autoAssignLead(conn, {
      leadId,
      mobile,
      assignedBy: user.user_id,
    });

    // koi active sales member nahi => 'accepted', admin manually assign karega
    const nextStatus = salesUserId ? "assigned_to_sales_team" : "accepted";
    await referenceModel.updateStatus(id, nextStatus, conn);
    await referenceModel.addStatusHistory(
      {
        entity_type: "customer_reference",
        entity_id: id,
        from_status: "submitted",
        to_status: nextStatus,
        changed_by: user.user_id,
        remarks: salesUserId
          ? "Auto-assigned to sales team"
          : "Lead created, waiting for manual assignment",
      },
      conn,
    );

    if (salesUserId) {
      await notifyPartner(conn, {
        partnerId: user.user_id,
        type: NOTIFY.LEAD_ASSIGNED,
        title: "Lead assigned",
        message: `Your reference ${code} has been assigned to our sales team.`,
        entityType: "customer_reference",
        entityId: id,
      });
    }

    return id;
  });
  
  const ref = await referenceModel.getReferenceById(referenceId);
  return toPartnerView(ref);
}

// ---------------------------------------------------------------- list
export async function listReferencesService(user, query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);

  const filters = { page, limit };

  if (query.status) {
    // "expired" sirf partner ke liye valid hai (admin/sales ko real status dikhta hai)
    const expiredFilter = user.role === "partner" && query.status === "expired";
    if (!expiredFilter && !STATUSES.includes(query.status))
      throw httpError(400, "Invalid status filter");
    filters.status = query.status;
  }
  filters.partnerView = user.role === "partner";

  if (query.q && String(query.q).trim()) filters.q = String(query.q).trim();

  if (user.role === "partner") {
    filters.partnerId = user.user_id; // hamesha apni hi
  } else {
    if (query.partner_id) {
      const pid = parsePositiveInt(query.partner_id);
      if (!pid) throw httpError(400, "Invalid partner_id");
      filters.partnerId = pid;
    }
    if (
      query.is_potential_duplicate !== undefined &&
      query.is_potential_duplicate !== ""
    ) {
      filters.isDuplicate = query.is_potential_duplicate === "true" ? 1 : 0;
    }
  }

  const { rows, total } = await referenceModel.listReferences(filters);

  return {
    items: rows.map((r) => viewFor(user, r)),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

// ---------------------------------------------------------------- detail
export async function getReferenceService(user, idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid reference id");

  const ref = await referenceModel.getReferenceById(id);

  // dusre partner ka reference => 404 (existence leak nahi)
  if (!ref || (user.role === "partner" && ref.partner_id !== user.user_id)) {
    throw httpError(404, "Reference not found");
  }

  const history = await referenceModel.getStatusHistory(id);

  if (user.role === "admin") {
    return { ...ref, status_history: history };
  }

  // partner: expiry ke baad ki real history chhupao, last mein "expired" dikhao
  const visible = ref.expired_at
    ? history.filter((h) => new Date(h.created_at) < new Date(ref.expired_at))
    : history;

  const items = visible.map((h) => ({
    to_status: h.to_status,
    created_at: h.created_at,
  }));
  if (ref.expired_at) {
    items.push({ to_status: "expired", created_at: ref.expired_at });
  }

  return { ...toPartnerView(ref), status_history: items };
}

// cron ke liye naya function (notifyPartner, NOTIFY already imported hain)
export async function expireDueReferencesService(batch = 200) {
  const ids = await referenceModel.findExpiryDue(batch);
  let count = 0;
  for (const id of ids) {
    try {
      await withTransaction(async (conn) => {
        const ref = await referenceModel.getReferenceForUpdate(id, conn); // row lock
        if (!ref || !(await referenceModel.stampExpired(id, conn))) return;
        await notifyPartner(conn, {
          partnerId: ref.partner_id,
          type: NOTIFY.REFERENCE_EXPIRED,
          title: "Reference expired",
          message: `Your reference ${ref.reference_code} for ${ref.customer_name} has expired.`,
          entityType: "customer_reference",
          entityId: id,
        });
        count++;
      });
    } catch (err) {
      console.error(`[expiry] reference ${id} failed`, err);
    }
  }
  return count;
}
