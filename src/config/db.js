import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();2

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z", // UTC
});

// schema ke hisaab se har connection UTC pe
db.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

export async function withTransaction(callback) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export default db;