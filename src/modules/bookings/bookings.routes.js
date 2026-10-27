import express from "express";
import { createBooking, listBookings, getBooking, verifyBooking } from "./bookings.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.post("/", authorize("admin", "sales_team"), createBooking);
router.get("/", authorize("admin", "sales_team"), listBookings);
router.get("/:id", authorize("admin", "sales_team"), getBooking);
router.patch("/:id/verify", authorize("admin"), verifyBooking);

export default router;