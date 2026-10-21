export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// on 500 DB/SQL to hide db error from client
export function sendError(res, error) {
  if (error.status) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  console.error(error);
  res.status(500).json({ success: false, message: "Internal server error" });
}