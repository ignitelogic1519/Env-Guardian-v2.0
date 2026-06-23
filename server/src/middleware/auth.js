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

module.exports = { requireApiKey, requireJWT, requireAuth };
