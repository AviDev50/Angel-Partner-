import crypto from "crypto";
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

const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS) || 30;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueRefreshToken(conn, userId) {
  const raw = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await authModel.saveRefreshToken(conn, {
    userId,
    tokenHash: hashToken(raw),
    expiresAt,
  });
  return raw;
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

  // user + wallet in one transaction
  const userId = await authModel.createPartner({
    role_id: partnerRole.role_id,
    full_name: String(full_name).trim(),
    mobile: cleanMobile,
    email: cleanEmail,
    password_hash: passwordHash,
    date_of_birth: date_of_birth || null,
  });

  const user = await authModel.getUserById(userId);

  const refreshToken = await issueRefreshToken(null, user.user_id);
  return { token: signToken(user), refresh_token: refreshToken, user: sanitizeUser(user) };
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

  const refreshToken = await issueRefreshToken(null, user.user_id);
  return { token: signToken(user), refresh_token: refreshToken, user: sanitizeUser(user) };
}

export async function getMeService(userId) {
  const user = await authModel.getUserById(userId);
  if (!user || user.status !== "active") {
    throw httpError(401, "Unauthorized");
  }
  return sanitizeUser(user);
}

export async function refreshService(refreshToken) {
  if (!refreshToken) throw httpError(400, "refresh_token is required");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const row = await authModel.findRefreshToken(conn, hashToken(String(refreshToken)));

    if (!row) throw httpError(401, "Invalid refresh token");

    // reuse detection: revoked token dobara aaya = chori ka sign, saare sessions kill
    if (row.revoked_at) {
      await conn.commit();
      await authModel.revokeAllUserRefreshTokens(row.user_id);
      throw httpError(401, "Refresh token reused. Please login again.");
    }

    if (new Date(row.expires_at) <= new Date()) {
      throw httpError(401, "Refresh token expired. Please login again.");
    }

    const user = await authModel.getUserWithRoleById(row.user_id);
    if (!user || user.status !== "active") {
      throw httpError(401, "Unauthorized");
    }

    // rotation: purana revoke, naya issue
    await authModel.revokeRefreshToken(conn, row.refresh_token_id);
    const newRefresh = await issueRefreshToken(conn, user.user_id);

    await conn.commit();
    return { token: signToken(user), refresh_token: newRefresh };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export async function logoutService(refreshToken) {
  if (!refreshToken) throw httpError(400, "refresh_token is required");
  const row = await authModel.findRefreshToken(null, hashToken(String(refreshToken)));
  // idempotent: token nahi mila ya pehle se revoked ho toh bhi success
  if (row && !row.revoked_at) {
    await authModel.revokeRefreshToken(null, row.refresh_token_id);
  }
}

export async function logoutAllService(userId) {
  await authModel.revokeAllUserRefreshTokens(userId);
}