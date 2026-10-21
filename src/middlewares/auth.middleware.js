import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { sendError } from "../utils/httpError.js";

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Token missing" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  try {
    // status + role DB se (token mein purana role/status ho sakta hai)
    const [rows] = await db.query(
      `SELECT u.user_id, u.status, r.role_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
       WHERE u.user_id = ? AND u.deleted_at IS NULL
       LIMIT 1`,
      [payload.user_id],
    );
    const user = rows[0];

    if (!user || user.status !== "active") {
      return res.status(401).json({ success: false, message: "Account is inactive or not found" });
    }

    req.user = { user_id: user.user_id, role: user.role_name };
    next();
  } catch (error) {
    sendError(res, error);
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  };
}