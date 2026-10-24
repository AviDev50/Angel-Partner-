import express from "express";
import {
  createReference,
  listReferences,
  getReference,
  reviewReference,
} from "./references.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("partner"), createReference);
router.get("/", authorize("partner", "admin"), listReferences);
router.get("/:id", authorize("partner", "admin"), getReference);
router.patch("/:id/review", authorize("admin"), reviewReference);

export default router;
