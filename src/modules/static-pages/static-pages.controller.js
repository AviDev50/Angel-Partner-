import * as pageService from "./static-pages.service.js";
import { sendError } from "../../utils/httpError.js";

export function getPage(pageType) {
  return async (req, res) => {
    try {
      const data = await pageService.getPageService(pageType);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function savePage(pageType) {
  return async (req, res) => {
    try {
      const data = await pageService.upsertPageService(pageType, req.body, req.user.user_id);
      res.status(200).json({ success: true, message: "Page saved", data });
    } catch (error) {
      sendError(res, error);
    }
  };
}