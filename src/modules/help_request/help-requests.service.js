import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import * as model from "./help-requests.model.js";

const TITLE_MAX = 200;
const MESSAGE_MAX = 2000;

function present(row) {
  return { ...row, is_read: Boolean(row.is_read) };
}

// ---------------------------------------------------------------- create (partner)
export async function createHelpRequestService(user, body) {
  const title = optionalString(body.title, TITLE_MAX, "title");
  if (!title) throw httpError(400, "title is required");
  const message = optionalString(body.message, MESSAGE_MAX, "message");
  if (!message) throw httpError(400, "message is required");

  const id = await model.insertHelpRequest({ partner_id: user.user_id, title, message });
  return present(await model.getHelpRequestById(id));
}

// ---------------------------------------------------------------- list / detail / delete (admin)
export async function listHelpRequestsService(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.is_read !== undefined && query.is_read !== "") {
    if (!["0", "1"].includes(String(query.is_read))) throw httpError(400, "Invalid is_read");
    filters.isRead = Number(query.is_read);
  }
  if (query.partner_id) {
    const pid = parsePositiveInt(query.partner_id);
    if (!pid) throw httpError(400, "Invalid partner_id");
    filters.partnerId = pid;
  }

  const [{ rows, total }, unreadCount] = await Promise.all([
    model.listHelpRequests(filters),
    model.countUnread(),
  ]);
  return {
    items: rows.map(present),
    unread_count: unreadCount,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

// opening a request marks it as read
export async function getHelpRequestService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid help request id");

  let row = await model.getHelpRequestById(id);
  if (!row) throw httpError(404, "Help request not found");

  if (!row.is_read) {
    await model.markHelpRequestRead(id);
    row = await model.getHelpRequestById(id);
  }
  return present(row);
}

export async function deleteHelpRequestService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid help request id");

  const affected = await model.deleteHelpRequest(id);
  if (!affected) throw httpError(404, "Help request not found");
}

// ---------------------------------------------------------------- support number
const SUPPORT_CHARS = /^[+\d\s\-()]+$/;

// mobile / landline -> 10 digit string, warna null
function normalizeSupportNumber(value) {
  const raw = String(value).trim();
  if (!SUPPORT_CHARS.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[1-9]\d{9}$/.test(digits) ? digits : null;
}

function presentSupport(row) {
  return { support_number: row?.phone_number ?? null, updated_at: row?.updated_at ?? null };
}

// partner + admin
export async function getSupportNumberService() {
  return presentSupport(await model.getSupportContact());
}

// admin: set / change; empty value removes the number
export async function updateSupportNumberService(user, body) {
  const raw = body.support_number;
  if (raw === undefined) {
    throw httpError(400, "support_number is required (send an empty value to remove it)");
  }

  let phone = null;
  if (raw !== null && String(raw).trim() !== "") {
    phone = normalizeSupportNumber(raw);
    if (!phone) throw httpError(400, "support_number must be a valid mobile or landline number");
  }

  await model.upsertSupportContact({ phone_number: phone, updated_by: user.user_id });
  return presentSupport(await model.getSupportContact());
}