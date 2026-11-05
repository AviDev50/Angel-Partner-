export function runAfterCommit(conn, fn) {
  if (Array.isArray(conn?.afterCommit)) conn.afterCommit.push(fn); // transaction ke andar
  else fn();                                                       // pool, already committed
}