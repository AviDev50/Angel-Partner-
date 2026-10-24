import db from "../../config/db.js";

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
    `SELECT u.user_id, u.full_name, u.email, u.mobile, u.status, r.role_name
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
