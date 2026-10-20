import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import {
  normalizeMobile,
  isValidEmail,
  parsePositiveInt,
} from "../../utils/validators.js";
import * as referenceModel from "./references.model.js";

const STATUSES = [
  "submitted", "under_review", "accepted", "rejected", "assigned_to_sales_team",
  "in_progress", "site_visit_scheduled", "site_visit_completed", "converted", "closed",
];

// admin review ke allowed transitions (aage ke statuses leads module handle karega)
const REVIEW_TRANSITIONS = {
  submitted: ["under_review", "accepted", "rejected"],
  under_review: ["accepted", "rejected"],
};

function optionalString(value, max, field) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw httpError(400, `${field} must be at most ${max} characters`);
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
    status: ref.status,
    review_remarks: ref.review_remarks,
    created_at: ref.created_at,
    updated_at: ref.updated_at,
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
  if (!mobile) throw httpError(400, "customer_mobile must be a valid 10-digit mobile number");

  let email = optionalString(body.customer_email, 190, "customer_email");
  if (email) {
    email = email.toLowerCase();
    if (!isValidEmail(email)) throw httpError(400, "customer_email is invalid");
  }

  let budget = null;
  if (body.customer_budget !== undefined && body.customer_budget !== null && body.customer_budget !== "") {
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
    preferred_project_location: optionalString(body.preferred_project_location, 255, "preferred_project_location"),
    remarks: optionalString(body.remarks, 5000, "remarks"),
  };

  const referenceId = await withTransaction(async (conn) => {
    // duplicate => sirf flag, kabhi reject/merge nahi
    const original = await referenceModel.findEarliestByMobile(mobile, conn);

    const id = await referenceModel.insertReference(
      {
        ...data,
        is_potential_duplicate: original ? 1 : 0,
        duplicate_of_reference_id: original ? original.customer_reference_id : null,
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
    if (!STATUSES.includes(query.status)) throw httpError(400, "Invalid status filter");
    filters.status = query.status;
  }
  if (query.q && String(query.q).trim()) filters.q = String(query.q).trim();

  if (user.role === "partner") {
    filters.partnerId = user.user_id; // hamesha apni hi
  } else {
    if (query.partner_id) {
      const pid = parsePositiveInt(query.partner_id);
      if (!pid) throw httpError(400, "Invalid partner_id");
      filters.partnerId = pid;
    }
    if (query.is_potential_duplicate !== undefined && query.is_potential_duplicate !== "") {
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
  return {
    ...toPartnerView(ref),
    status_history: history.map((h) => ({ to_status: h.to_status, created_at: h.created_at })),
  };
}

// ---------------------------------------------------------------- review (admin)
export async function reviewReferenceService(user, idParam, body) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid reference id");

  const decision = String(body.decision || "").trim();
  if (!["under_review", "accepted", "rejected"].includes(decision)) {
    throw httpError(400, "decision must be one of: under_review, accepted, rejected");
  }

  const remarks = optionalString(body.remarks, 500, "remarks");
  if (decision === "rejected" && !remarks) {
    throw httpError(400, "remarks are required when rejecting a reference");
  }

  await withTransaction(async (conn) => {
    // row lock: do admin ek saath review karein to race na ho
    const ref = await referenceModel.getReferenceForUpdate(id, conn);
    if (!ref) throw httpError(404, "Reference not found");

    const allowed = REVIEW_TRANSITIONS[ref.status] || [];
    if (!allowed.includes(decision)) {
      throw httpError(409, `Cannot move reference from '${ref.status}' to '${decision}'`);
    }

    await referenceModel.updateReview(id, decision, user.user_id, remarks, conn);

    await referenceModel.addStatusHistory(
      {
        entity_type: "customer_reference",
        entity_id: id,
        from_status: ref.status,
        to_status: decision,
        changed_by: user.user_id,
        remarks,
      },
      conn,
    );

    if (decision === "accepted") {
      const leadId = await referenceModel.createLeadFromReference(ref, user.user_id, conn);
      await referenceModel.addStatusHistory(
        {
          entity_type: "lead",
          entity_id: leadId,
          from_status: null,
          to_status: "new",
          changed_by: user.user_id,
          remarks: `Created from ${ref.reference_code}`,
        },
        conn,
      );
    }

    const copy = {
      under_review: ["reference_under_review", "Reference under review",
        `Your reference ${ref.reference_code} for ${ref.customer_name} is now under review.`],
      accepted: ["reference_accepted", "Reference accepted",
        `Your reference ${ref.reference_code} for ${ref.customer_name} has been accepted.`],
      rejected: ["reference_rejected", "Reference rejected",
        `Your reference ${ref.reference_code} for ${ref.customer_name} was rejected. Reason: ${remarks}`],
    }[decision];

    await referenceModel.createNotification(
      { user_id: ref.partner_id, type: copy[0], title: copy[1], message: copy[2], entity_id: id },
      conn,
    );
  });

  const ref = await referenceModel.getReferenceById(id);
  const history = await referenceModel.getStatusHistory(id);
  return { ...ref, status_history: history };
}