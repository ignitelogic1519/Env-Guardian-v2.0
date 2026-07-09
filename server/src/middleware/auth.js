const jwt = require("jsonwebtoken");
require("dotenv").config();

// API Key middleware - for APK device requests
const requireApiKey = (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized: Invalid API key" });
  }
  next();
};

// JWT middleware - for dashboard admin requests
const requireJWT = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>
  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized: No token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: "Forbidden: Invalid or expired token" });
  }
};

// Flexible middleware - accepts either API key OR JWT
// Used for dashboard routes that the HTML dashboard hits with x-api-key
const requireAuth = (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key && key === process.env.API_KEY) {
    return next();
  }
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token) {
    try {
      req.admin = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {}
  }
  return res.status(401).json({ success: false, error: "Unauthorized" });
};

// Role gate for dashboard mutations. Runs AFTER requireAuth.
// - API-key callers (the APK / trusted automation) have no role → allowed
//   (preserves existing device behaviour).
// - JWT callers must hold one of the allowed roles (from the users table).
const requireRole = (...roles) => (req, res, next) => {
  if (!req.admin) return next(); // authenticated via x-api-key
  if (roles.includes(req.admin.role)) return next();
  return res.status(403).json({
    success: false,
    error: `Forbidden: requires role ${roles.join(" or ")} (you are ${req.admin.role})`,
  });
};

module.exports = { requireApiKey, requireJWT, requireAuth, requireRole };
