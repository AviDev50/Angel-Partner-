import * as service from "./reports.service.js";
import { sendError } from "../../utils/httpError.js";
import { sendCsv } from "../../utils/csv.js";

function handler(key) {
  return async (req, res) => {
    try {
      const out = await service.runReportService(key, req.query);
      if (out.csv) return sendCsv(res, out.csv);
      res.status(200).json({ success: true, data: out.json });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export const partnerPerformance = handler("partner-performance");
export const funnel = handler("funnel");
export const salesPerformance = handler("sales-performance");
export const commissionsReport = handler("commissions");
export const pointsLedger = handler("points-ledger");