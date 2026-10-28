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