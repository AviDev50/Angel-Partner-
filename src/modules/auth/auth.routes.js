import express from "express";
import { login, register, me, refresh, logout, logoutAll } from "./auth.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);              // public: refresh token body mein
router.post("/logout", logout);                // public: expired access token pe bhi logout chalna chahiye
router.post("/logout-all", authenticate, logoutAll);
router.get("/me", authenticate, me);

export default router;