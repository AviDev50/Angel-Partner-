import db from "../../config/db.js";

const USER_COLUMNS = `
  u.user_id, u.full_name, u.mobile, u.email, u.status,
  u.last_login_at, u.created_at, u.updated_at, r.role_name AS role
`;
const USER_FROM = `
  FROM users u
  JOIN roles r ON r.role_id = u.role_id AND r.deleted_at IS NULL
`;

export async function insertUser(data, conn = db) {
  try {
    const [result] = await conn.query(
      `INSERT INTO users (role_id, full_name, mobile, email, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [data.role_id, data.full_name, data.mobile, data.email, data.password_hash],
    );
    return result.insertId;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error("Email or mobile already registered");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function getUserById(id, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${USER_COLUMNS} ${USER_FROM}
     WHERE u.user_id = ? AND u.deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  return rows[0];
}

export async function listUsers({ role, status, q, page, limit }) {
  const where = ["u.deleted_at IS NULL"];
  const params = [];

  if (role) {
    where.push("r.role_name = ?");
    params.push(role);
  }
  if (status) {
    where.push("u.status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT ${USER_COLUMNS} ${USER_FROM}
     WHERE ${whereSql}
     ORDER BY u.created_at DESC, u.user_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total ${USER_FROM} WHERE ${whereSql}`,
    params,
  );

  return { rows, total };
}

export async function updateUserStatus(id, status, conn = db) {
  await conn.query(`UPDATE users SET status = ? WHERE user_id = ?`, [status, id]);
}