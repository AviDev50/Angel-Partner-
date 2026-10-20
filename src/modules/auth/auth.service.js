import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import * as authModel from "./auth.model.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, role: user.role_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" },
  );
}

function sanitizeUser(user) {
  return {
    user_id: user.user_id,
    full_name: user.full_name,
    email: user.email,
    mobile: user.mobile,
    role: user.role_name,
  };
}

export async function registerService(body) {
  const { full_name, mobile, email, password, date_of_birth } = body;

  if (!full_name || !mobile || !email || !password) {
    throw httpError(400, "full_name, mobile, email and password are required");
  }
  if (password.length < 8) {
    throw httpError(400, "Password must be at least 8 characters");
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const cleanMobile = String(mobile).trim();

  // unique keys soft-deleted rows pe bhi apply hote hain, isliye deleted_at ignore karke check
  const existing = await authModel.findByEmailOrMobile(cleanEmail, cleanMobile);
  if (existing) {
    throw httpError(409, "Email or mobile already registered");
  }

  const partnerRole = await authModel.getRoleByName("partner");
  if (!partnerRole) {
    throw httpError(500, "Partner role not configured");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // user + wallet ek transaction mein
  const userId = await authModel.createPartner({
    role_id: partnerRole.role_id,
    full_name: String(full_name).trim(),
    mobile: cleanMobile,
    email: cleanEmail,
    password_hash: passwordHash,
    date_of_birth: date_of_birth || null,
  });

  const user = await authModel.getUserById(userId);

  return { token: signToken(user), user: sanitizeUser(user) };
}

export async function loginService(email, password) {
  if (!email || !password) {
    throw httpError(400, "Email and password are required");
  }

  const user = await authModel.getUserByEmail(
    String(email).toLowerCase().trim(),
  );

  if (!user) {
    throw httpError(401, "Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw httpError(401, "Invalid email or password");
  }

  // password check ke BAAD status check, taaki email enumeration na ho
  if (user.status !== "active") {
    throw httpError(403, "Account is inactive. Contact administrator.");
  }

  await authModel.updateLastLogin(user.user_id);

  return { token: signToken(user), user: sanitizeUser(user) };
}

export async function getMeService(userId) {
  const user = await authModel.getUserById(userId);
  if (!user || user.status !== "active") {
    throw httpError(401, "Unauthorized");
  }
  return sanitizeUser(user);
}