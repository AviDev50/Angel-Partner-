import * as service from "./redemptions.service.js";
import { sendError } from "../../utils/httpError.js";

export async function createRedemption(req, res) {
  try {
    const data = await service.createRedemptionService(req.user, req.body);
    res.status(201).json({ success: true, message: "Withdrawal recorded", data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function listRedemptions(req, res) {
  try {
    const data = await service.listRedemptionsService(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}

export async function getRedemption(req, res) {
  try {
    const data = await service.getRedemptionService(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}