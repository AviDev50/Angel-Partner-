import express from "express";
import { listCommissions, getCommission, markCommissionPaid } from "./commissions.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";
import { uploadPhoto } from "../../middlewares/upload.js";

const router = express.Router();

router.use(authenticate, authorize("admin"));

router.get("/", listCommissions);
router.get("/:id", getCommission);
router.patch("/:id/mark-paid", uploadPhoto("photo"), markCommissionPaid);

export default router;