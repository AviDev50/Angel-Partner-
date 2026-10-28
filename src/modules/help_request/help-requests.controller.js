import * as service from "./help-requests.service.js";
import { sendError } from "../../utils/httpError.js";

export async function createHelpRequest(req, res) {
  try {
    const data = await service.createHelpRequestService(req.user, req.body);
    res.status(201).json({ success: true, message: "Help request submitted", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listHelpRequests(req, res) {
  try {
    const data = await service.listHelpRequestsService(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getHelpRequest(req, res) {
  try {
    const data = await service.getHelpRequestService(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function deleteHelpRequest(req, res) {
  try {
    await service.deleteHelpRequestService(req.params.id);
    res.status(200).json({ success: true, message: "Help request deleted" });
  } catch (error) {
    sendError(res, error);
  }
}