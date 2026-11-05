import express from "express";
import {
  listMine, unreadCount, markRead, markAllRead, sendNotification,
  listSent, deleteSent, deleteMine,
  registerDeviceToken, removeDeviceToken,
} from "./notifications.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";
const router = express.Router();
router.use(authenticate);

// device token: har logged-in role, /:id se PEHLE
router.post("/device-token", registerDeviceToken);
router.delete("/device-token", removeDeviceToken);

// admin
router.post("/send", authorize("admin"), sendNotification);
router.get("/sent", authorize("admin"), listSent);
router.delete("/sent/:id", authorize("admin"), deleteSent);

// partner //sales both
router.get("/", authorize("partner", "sales_team"), listMine);
router.get("/unread-count", authorize("partner", "sales_team"), unreadCount);
router.patch("/read-all", authorize("partner", "sales_team"), markAllRead);
router.patch("/:id/read", authorize("partner", "sales_team"), markRead);
router.delete("/:id", authorize("partner", "sales_team"), deleteMine);

export default router;