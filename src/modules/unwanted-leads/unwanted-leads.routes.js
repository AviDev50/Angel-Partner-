import express from "express";
import {
  createUnwantedLead,
  listUnwantedLeads,
  getUnwantedLead,
  assignUnwantedLead,
} from "./unwanted-leads.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("admin"), createUnwantedLead);
router.get("/", authorize("admin", "partner"), listUnwantedLeads);
router.get("/:id", authorize("admin", "partner"), getUnwantedLead);
router.post("/:id/assign", authorize("admin"), assignUnwantedLead);

export default router;