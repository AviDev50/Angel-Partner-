import express from "express";
import {
  partnerPerformance,
  funnel,
  salesPerformance,
  commissionsReport,
  pointsLedger,
} from "./reports.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

// reports sirf admin ke liye
router.use(authenticate, authorize("admin"));

router.get("/partner-performance", partnerPerformance);
router.get("/funnel", funnel);
router.get("/sales-performance", salesPerformance);
router.get("/commissions", commissionsReport);
router.get("/points-ledger", pointsLedger);

export default router;