import jwt from "jsonwebtoken";

export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ success: false, message: "Token missing" });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { user_id, role }
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

// usage: router.get("/x", authenticate, authorize("admin", "sales_team"), handler)
export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  };
}