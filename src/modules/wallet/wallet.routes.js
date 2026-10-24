import express from "express";
import {
  getMyWallet,
  listMyTransactions,
  getPartnerWallet,
  listPartnerTransactions,
  listAllTransactions,
} from "./wallet.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/me", authorize("partner"), getMyWallet);
router.get("/me/transactions", authorize("partner"), listMyTransactions);

router.get("/transactions", authorize("admin"), listAllTransactions);
router.get("/partners/:partnerId", authorize("admin"), getPartnerWallet);
router.get(
  "/partners/:partnerId/transactions",
  authorize("admin"),
  listPartnerTransactions,
);

export default router;
