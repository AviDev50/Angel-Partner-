import express from "express";
import { login, register, me, refresh, logout, logoutAll } from "./auth.controller.js";
import { authenticate } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);              // public: refresh token inside the body 
router.post("/logout", logout);                // public: logout also work in expired access token 
router.post("/logout-all", authenticate, logoutAll);
router.get("/me", authenticate, me);

export default router;