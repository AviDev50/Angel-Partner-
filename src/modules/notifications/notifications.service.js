import { withTransaction } from "../../config/db.js";
import { httpError } from "../../utils/httpError.js";
import { parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import { notifyPartners, notifyAllPartners, NOTIFY } from "../../utils/notify.js";
import * as model from "./notifications.model.js";

const MAX_TARGETS = 200;

function paging(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit };
}

// ---------------------------------------------------------------- partner
export async function listMineService(user, query) {
  const { page, limit } = paging(query);
  const filters = { userId: user.user_id, page, limit };

  if (query.is_read !== undefined && query.is_read !== "") {
    if (!["true", "false"].includes(query.is_read)) throw httpError(400, "is_read must be true or false");
    filters.isRead = query.is_read === "true" ? 1 : 0;
  }

  const { rows, total } = await model.listForUser(filters);
  return { items: rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
}

export async function unreadCountService(user) {
  return { unread: await model.countUnread(user.user_id) };
}

export async function markReadService(user, idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid notification id");

  // dusre ki notification => 404
  const n = await model.getForUser(id, user.user_id);
  if (!n) throw httpError(404, "Notification not found");

  if (!n.is_read) await model.markRead(id, user.user_id);
  return model.getForUser(id, user.user_id);
}

export async function markAllReadService(user) {
  return { updated: await model.markAllRead(user.user_id) };
}

// ---------------------------------------------------------------- admin: custom send
export async function sendService(user, body) {
  const title = optionalString(body.title, 200, "title");
  if (!title) throw httpError(400, "title is required");
  const message = optionalString(body.message, 1000, "message");
  if (!message) throw httpError(400, "message is required");

  const sendToAll = body.send_to_all === true || body.send_to_all === "true";
  const hasIds = body.partner_ids !== undefined && body.partner_ids !== null;
  if (sendToAll === hasIds) {
    throw httpError(400, "Provide either send_to_all: true or partner_ids (not both)");
  }

  let ids = null;
  if (hasIds) {
    if (!Array.isArray(body.partner_ids) || body.partner_ids.length === 0) {
      throw httpError(400, "partner_ids must be a non-empty array");
    }
    ids = [...new Set(body.partner_ids.map((v) => parsePositiveInt(v)))];
    if (ids.includes(null)) throw httpError(400, "partner_ids must contain valid partner ids");
    if (ids.length > MAX_TARGETS) throw httpError(400, `partner_ids can have at most ${MAX_TARGETS} entries`);
  }

  return withTransaction(async (conn) => {
    if (ids) {
      const found = await model.findActivePartners(ids, conn);
      if (found.length !== ids.length) throw httpError(400, "All partner_ids must be active partners");
    }

    // announcements row = admin ki sent history; har notification isse jud jaati hai
    const announcementId = await model.insertAnnouncement({ title, message, created_by: user.user_id }, conn);

    const payload = {
      type: sendToAll ? NOTIFY.ANNOUNCEMENT : NOTIFY.ADMIN_MESSAGE,
      title,
      message,
      entityType: "announcement",
      entityId: announcementId,
      announcementId,
    };
    const recipients = sendToAll ? await notifyAllPartners(conn, payload) : await notifyPartners(conn, ids, payload);
    if (!recipients) throw httpError(409, "No active partners to notify");

    return { announcement_id: announcementId, recipients };
  });
}

export async function listSentService(query) {
  const { page, limit } = paging(query);
  const { rows, total } = await model.listAnnouncements({ page, limit });
  return { items: rows, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } };
}

export async function deleteSentService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid id");

  await withTransaction(async (conn) => {
    const a = await model.getAnnouncementForUpdate(id, conn);
    if (!a) throw httpError(404, "Sent notification not found");
    await model.softDeleteAnnouncement(id, conn);
  });
}