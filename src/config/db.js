import mysql from "mysql2/promise";
import "dotenv/config";

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z", // UTC
});

// Har naye connection pe UTC set karo.
// "connection" event mein conn callback-style hota hai (promise nahi).
db.on("connection", (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.error("time_zone set failed:", err);
  });
});

export async function withTransaction(callback) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error("rollback failed:", rollbackErr);
    }
    throw err; // original error hi bahar jaayega
  } finally {
    conn.release();
  }
}

export default db;