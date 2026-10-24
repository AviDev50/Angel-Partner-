import express from "express";
import {
  listLeads,
  getLead,
  updateLeadStatus,
  assignLead,
  listFollowUps,
  addFollowUp,
} from "./leads.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/", authorize("admin", "sales_team"), listLeads);
router.get("/:id", authorize("admin", "sales_team"), getLead);
router.patch("/:id/status", authorize("admin", "sales_team"), updateLeadStatus);
router.post("/:id/assign", authorize("admin"), assignLead);
router.get("/:id/follow-ups", authorize("admin", "sales_team"), listFollowUps);
router.post("/:id/follow-ups", authorize("admin", "sales_team"), addFollowUp);

export default router;
