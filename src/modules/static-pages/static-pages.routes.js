import express from "express";
import { getPage, savePage } from "./static-pages.controller.js";
import { authenticate, authorize } from "../../middlewares/auth.middleware.js";

const router = express.Router();

const PAGES = {
  "privacy-policy": "PRIVACY_POLICY",
  "terms-and-conditions": "TERMS_AND_CONDITIONS",
  "about-us": "ABOUT_US",
};

for (const [slug, pageType] of Object.entries(PAGES)) {
  router.get(`/${slug}`, getPage(pageType)); // public
  router.put(`/${slug}`, authenticate, authorize("admin"), savePage(pageType));
}

export default router;