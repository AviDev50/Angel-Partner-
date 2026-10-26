import express from "express";
import { createRedemption, listRedemptions, getRedemption } from "./redemptions.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate, authorize("admin"));

router.post("/", createRedemption);
router.get("/", listRedemptions);
router.get("/:id", getRedemption);

export default router;