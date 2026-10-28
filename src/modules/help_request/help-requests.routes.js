import express from "express";
import {
  createHelpRequest,
  listHelpRequests,
  getHelpRequest,
  deleteHelpRequest,
} from "./help-requests.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("partner"), createHelpRequest);
router.get("/", authorize("admin"), listHelpRequests);
router.get("/:id", authorize("admin"), getHelpRequest);
router.delete("/:id", authorize("admin"), deleteHelpRequest);

export default router;