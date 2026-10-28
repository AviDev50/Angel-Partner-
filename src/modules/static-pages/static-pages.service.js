import { httpError } from "../../utils/httpError.js";
import * as pageModel from "./static-pages.model.js";

const MAX_TITLE = 200;
const MAX_CONTENT = 100000; // express.json() ki default body limit 100kb hai

export async function getPageService(pageType) {
  const page = await pageModel.getByType(pageType);
  if (!page) throw httpError(404, "Page not found");
  return page;
}

export async function upsertPageService(pageType, body, userId) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!title) throw httpError(400, "title is required");
  if (title.length > MAX_TITLE) throw httpError(400, `title must be at most ${MAX_TITLE} characters`);
  if (!content) throw httpError(400, "content is required");
  if (content.length > MAX_CONTENT) {
    throw httpError(400, `content must be at most ${MAX_CONTENT} characters`);
  }

  await pageModel.upsertPage({ page_type: pageType, title, content, updated_by: userId });
  return pageModel.getByType(pageType);
}