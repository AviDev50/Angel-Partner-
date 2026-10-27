import * as service from "./notifications.service.js";
import { sendError } from "../../utils/httpError.js";


export async function listMine(req, res) {
  try {
    const data = await service.listMineService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function unreadCount(req, res) {
  try {
    const data = await service.unreadCountService(req.user);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function markRead(req, res) {
  try {
    const data = await service.markReadService(req.user, req.params.id);
    res.status(200).json({ success: true, message: "Notification marked as read", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function markAllRead(req, res) {
  try {
    const data = await service.markAllReadService(req.user);
    res.status(200).json({ success: true, message: "All notifications marked as read", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function sendNotification(req, res) {
  try {
    const data = await service.sendService(req.user, req.body);
    res.status(201).json({ success: true, message: `Notification sent to ${data.recipients} partner(s)`, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listSent(req, res) {
  try {
    const data = await service.listSentService(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function deleteSent(req, res) {
  try {
    await service.deleteSentService(req.params.id);
    res.status(200).json({ success: true, message: "Notification deleted for all recipients" });
  } catch (error) {
    sendError(res, error);
  }
}