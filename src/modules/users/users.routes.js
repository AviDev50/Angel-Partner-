import express from "express";
import { createUser, listUsers, getUser, updateUserStatus } from "./users.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate, authorize("admin"));

router.post("/", createUser);
router.get("/", listUsers);
router.get("/:id", getUser);
router.patch("/:id/status", updateUserStatus);

export default router;