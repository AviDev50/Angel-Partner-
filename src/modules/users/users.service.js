import bcrypt from "bcryptjs";
import { httpError } from "../../utils/httpError.js";
import { normalizeMobile, isValidEmail, parsePositiveInt } from "../../utils/validators.js";
import { optionalString } from "../../utils/customerFields.js";
import * as userModel from "./users.model.js";
import { findByEmailOrMobile, getRoleByName } from "../auth/auth.model.js";

const ROLES = ["partner", "sales_team", "admin"];
const STATUSES = ["active", "inactive"];

export async function createSalesUserService(body) {
  const fullName = optionalString(body.full_name, 150, "full_name");
  if (!fullName) throw httpError(400, "full_name is required");

  const mobile = normalizeMobile(body.mobile);
  if (!mobile) throw httpError(400, "mobile must be a valid 10-digit mobile number");

  const email = optionalString(body.email, 190, "email")?.toLowerCase();
  if (!email || !isValidEmail(email)) throw httpError(400, "A valid email is required");

  const password = String(body.password ?? "");
  // bcrypt 72 bytes ke baad truncate karta hai
  if (password.length < 8 || Buffer.byteLength(password) > 72) {
    throw httpError(400, "Password must be 8 to 72 characters");
  }

  if (await findByEmailOrMobile(email, mobile)) {
    throw httpError(409, "Email or mobile already registered");
  }

  const role = await getRoleByName("sales_team");
  if (!role) throw httpError(500, "sales_team role not configured");

  const userId = await userModel.insertUser({
    role_id: role.role_id,
    full_name: fullName,
    mobile,
    email,
    password_hash: await bcrypt.hash(password, 10),
  });

  return userModel.getUserById(userId);
}

export async function listUsersService(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  const filters = { page, limit };

  if (query.role) {
    if (!ROLES.includes(query.role)) throw httpError(400, "Invalid role filter");
    filters.role = query.role;
  }
  if (query.status) {
    if (!STATUSES.includes(query.status)) throw httpError(400, "Invalid status filter");
    filters.status = query.status;
  }
  if (query.q && String(query.q).trim()) filters.q = String(query.q).trim();

  const { rows, total } = await userModel.listUsers(filters);

  return {
    items: rows,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

export async function getUserService(idParam) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid user id");

  const user = await userModel.getUserById(id);
  if (!user) throw httpError(404, "User not found");
  return user;
}

export async function updateUserStatusService(idParam, body) {
  const id = parsePositiveInt(idParam);
  if (!id) throw httpError(400, "Invalid user id");

  const status = String(body.status || "").trim();
  if (!STATUSES.includes(status)) throw httpError(400, "status must be 'active' or 'inactive'");

  const user = await userModel.getUserById(id);
  if (!user) throw httpError(404, "User not found");

  // admin accounts yahan se nahi badlenge (self lock-out bhi isi se rukta hai)
  if (user.role === "admin") throw httpError(403, "Admin accounts cannot be changed from here");
  if (user.status === status) throw httpError(409, `User is already ${status}`);

  await userModel.updateUserStatus(id, status);
  return userModel.getUserById(id);
}