import * as service from "./site-visits.service.js";
import { sendError } from "../../utils/httpError.js";

export async function scheduleSiteVisit(req, res) {
  try {
    const data = await service.scheduleSiteVisitService(req.user, req.body);
    res.status(201).json({ success: true, message: "Site visit scheduled", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listSiteVisits(req, res) {
  try {
    const data = await service.listSiteVisitsService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getSiteVisit(req, res) {
  try {
    const data = await service.getSiteVisitService(req.user, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function completeSiteVisit(req, res) {
  try {
    const data = await service.completeSiteVisitService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: "Site visit submitted for verification", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function cancelSiteVisit(req, res) {
  try {
    const data = await service.cancelSiteVisitService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: "Site visit cancelled", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function verifySiteVisit(req, res) {
  try {
    const data = await service.verifySiteVisitService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: `Site visit ${data.visit_status}`, data });
  } catch (error) {
    sendError(res, error);
  }
}