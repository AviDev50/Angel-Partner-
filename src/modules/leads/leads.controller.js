import * as leadService from "./leads.service.js";
import { sendError } from "../../utils/httpError.js";

export async function listLeads(req, res) {
  try {
    const data = await leadService.listLeadsService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getLead(req, res) {
  try {
    const data = await leadService.getLeadService(req.user, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function updateLeadStatus(req, res) {
  try {
    const data = await leadService.updateLeadStatusService(
      req.user,
      req.params.id,
      req.body,
    );
    res
      .status(200)
      .json({
        success: true,
        message: `Lead status updated to ${data.status}`,
        data,
      });
  } catch (error) {
    sendError(res, error);
  }
}

export async function assignLead(req, res) {
  try {
    const data = await leadService.assignLeadService(
      req.user,
      req.params.id,
      req.body,
    );
    res.status(200).json({ success: true, message: "Lead assigned", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listFollowUps(req, res) {
  try {
    const data = await leadService.listFollowUpsService(
      req.user,
      req.params.id,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function addFollowUp(req, res) {
  try {
    const data = await leadService.addFollowUpService(
      req.user,
      req.params.id,
      req.body,
    );
    res.status(201).json({ success: true, message: "Follow-up added", data });
  } catch (error) {
    sendError(res, error);
  }
}
