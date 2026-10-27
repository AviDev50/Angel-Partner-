import express from "express";
import {
  listMine,
  unreadCount,
  markRead,
  markAllRead,
  sendNotification,
  listSent,
  deleteSent,
  deleteMine,
} from "./notifications.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

// admin (static paths pehle, /:id se pehle)
router.post("/send", authorize("admin"), sendNotification);
router.get("/sent", authorize("admin"), listSent);
router.delete("/sent/:id", authorize("admin"), deleteSent);

// partner
router.get("/", authorize("partner"), listMine);
router.get("/unread-count", authorize("partner"), unreadCount);
router.patch("/read-all", authorize("partner"), markAllRead);
router.patch("/:id/read", authorize("partner"), markRead);
router.delete("/:id", authorize("partner"), deleteMine);

export default router;