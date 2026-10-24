import express from "express";
import {
  scheduleSiteVisit,
  listSiteVisits,
  getSiteVisit,
  completeSiteVisit,
  cancelSiteVisit,
  verifySiteVisit,
} from "./site-visits.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("admin", "sales_team"), scheduleSiteVisit);
router.get("/", authorize("admin", "sales_team"), listSiteVisits);
router.get("/:id", authorize("admin", "sales_team"), getSiteVisit);
router.patch("/:id/complete", authorize("admin", "sales_team"), completeSiteVisit);
router.patch("/:id/cancel", authorize("admin", "sales_team"), cancelSiteVisit);
router.patch("/:id/verify", authorize("admin"), verifySiteVisit);

export default router;