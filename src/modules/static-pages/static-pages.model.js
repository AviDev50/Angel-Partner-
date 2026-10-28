import db from "../../config/db.js";

const COLUMNS = `static_page_id, page_type, title, content, updated_at`;

export async function getByType(pageType, conn = db) {
  const [rows] = await conn.query(
    `SELECT ${COLUMNS} FROM static_pages
     WHERE page_type = ? AND deleted_at IS NULL
     LIMIT 1`,
    [pageType],
  );
  return rows[0];
}

// Upsert: row nahi hai toh insert, hai toh update (page_type UNIQUE hai)
export async function upsertPage({ page_type, title, content, updated_by }, conn = db) {
  await conn.query(
    `INSERT INTO static_pages (page_type, title, content, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       content = VALUES(content),
       updated_by = VALUES(updated_by),
       deleted_at = NULL`,
    [page_type, title, content, updated_by],
  );
}