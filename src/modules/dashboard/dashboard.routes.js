import express from "express";
import { getDashboard } from "./dashboard.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

// ek hi endpoint, role ke hisaab se alag data
router.get("/", authenticate, authorize("admin", "sales_team", "partner"), getDashboard);

export default router;