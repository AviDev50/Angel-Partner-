import express from "express";
import { login, register, me } from "./auth.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", register); // partner self-registration
router.post("/login", login);
router.get("/me", authenticate, me);

export default router;
