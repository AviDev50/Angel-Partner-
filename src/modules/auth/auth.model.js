import db from "../../config/db.js";
import { notifyPartner, NOTIFY } from "../../utils/notify.js";

export async function getUserByEmail(email) {
  const [rows] = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.mobile, u.password_hash,
            u.status, r.role_name
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.email = ? AND u.deleted_at IS NULL
     LIMIT 1`,
    [email],
  );
  return rows[0];
}

export async function getUserById(userId) {
  const [rows] = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.mobile, u.status, r.role_name, u.date_of_birth
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.user_id = ? AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );
  return rows[0];
}

// deleted_at filter jaan-bujh ke nahi hai: unique keys soft-deleted rows pe bhi apply hoti hain
export async function findByEmailOrMobile(email, mobile) {
  const [rows] = await db.query(
    `SELECT user_id FROM users WHERE email = ? OR mobile = ? LIMIT 1`,
    [email, mobile],
  );
  return rows[0];
}

export async function getRoleByName(roleName) {
  const [rows] = await db.query(
    `SELECT role_id, role_name FROM roles
     WHERE role_name = ? AND deleted_at IS NULL LIMIT 1`,
    [roleName],
  );
  return rows[0];
}

export async function createPartner(data) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO users
         (role_id, full_name, mobile, email, password_hash, date_of_birth)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.role_id,
        data.full_name,
        data.mobile,
        data.email,
        data.password_hash,
        data.date_of_birth,
      ],
    );

    // schema ke hisaab se har partner ka ek wallet row
    await conn.query(`INSERT INTO partner_wallets (partner_id) VALUES (?)`, [
      result.insertId,
    ]);

    await notifyPartner(conn, {
  partnerId: result.insertId,
  type: NOTIFY.REGISTRATION,
  title: "Welcome to Angel Partner",
  message: `Welcome ${data.full_name}! Your registration was successful.`,
});

    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error("Email or mobile already registered");
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateLastLogin(userId) {
  await db.query(
    `UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE user_id = ?`,
    [userId],
  );
}

export async function saveRefreshToken(conn, { userId, tokenHash, expiresAt }) {
  await (conn || db).query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt],
  );
}

export async function findRefreshToken(conn, tokenHash) {
  const [rows] = await (conn || db).query(
    `SELECT refresh_token_id, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = ? AND deleted_at IS NULL
     LIMIT 1 ${conn ? "FOR UPDATE" : ""}`,
    [tokenHash],
  );
  return rows[0];
}

export async function revokeRefreshToken(conn, refreshTokenId) {
  const [r] = await (conn || db).query(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP()
     WHERE refresh_token_id = ? AND revoked_at IS NULL`,
    [refreshTokenId],
  );
  return r.affectedRows;
}

export async function revokeAllUserRefreshTokens(userId) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
}

export async function getUserWithRoleById(userId) {
  const [rows] = await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.mobile, u.status, r.role_name
     FROM users u
     JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
     WHERE u.user_id = ? AND u.deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  return rows[0];
}