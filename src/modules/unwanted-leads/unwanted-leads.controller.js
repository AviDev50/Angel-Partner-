import * as service from "./unwanted-leads.service.js";
import { sendError } from "../../utils/httpError.js";

export async function createUnwantedLead(req, res) {
  try {
    const data = await service.createUnwantedLeadService(req.user, req.body);
    res.status(201).json({ success: true, message: "Unwanted lead created", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listUnwantedLeads(req, res) {
  try {
    const data = await service.listUnwantedLeadsService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getUnwantedLead(req, res) {
  try {
    const data = await service.getUnwantedLeadService(req.user, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function assignUnwantedLead(req, res) {
  try {
    const data = await service.assignUnwantedLeadService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: "Unwanted lead assigned", data });
  } catch (error) {
    sendError(res, error);
  }
}