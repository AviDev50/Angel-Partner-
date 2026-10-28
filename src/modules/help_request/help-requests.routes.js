import express from "express";
import {
  createHelpRequest,
  listHelpRequests,
  getHelpRequest,
  deleteHelpRequest,
  getSupportNumber,
  updateSupportNumber,
} from "./help-requests.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// support-number routes must stay ABOVE "/:id"
router.get("/support-number", authorize("partner", "admin"), getSupportNumber);
router.put("/support-number", authorize("admin"), updateSupportNumber);

router.post("/", authorize("partner"), createHelpRequest);
router.get("/", authorize("admin"), listHelpRequests);
router.get("/:id", authorize("admin"), getHelpRequest);
router.delete("/:id", authorize("admin"), deleteHelpRequest);

export default router;