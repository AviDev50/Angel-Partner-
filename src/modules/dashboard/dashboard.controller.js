import * as service from "./dashboard.service.js";
import { sendError } from "../../utils/httpError.js";

export async function getDashboard(req, res) {
  try {
    const data = await service.getDashboardService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
}