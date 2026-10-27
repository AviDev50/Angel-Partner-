import * as service from "./commissions.service.js";
import { sendError } from "../../utils/httpError.js";

export async function listCommissions(req, res) {
  try {
    const data = await service.listCommissionsService(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getCommission(req, res) {
  try {
    const data = await service.getCommissionService(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function markCommissionPaid(req, res) {
  try {
    const data = await service.markPaidService(req.user, req.params.id, req.body);
    res.status(200).json({ success: true, message: "Commission marked as paid", data });
  } catch (error) {
    sendError(res, error);
  }
}