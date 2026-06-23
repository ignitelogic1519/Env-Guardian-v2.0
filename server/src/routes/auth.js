const router = require("express").Router();
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
require("dotenv").config();

// POST /api/auth/login
// Body: { org_name, username, password }
router.post("/login", async (req, res) => {
  try {
    const { org_name, username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password are required" });
    }

    // Look up user in admin_users table
    const result = await pool.query(
      `SELECT id, org_name, username, password, role, full_name, is_active
       FROM public.users
       WHERE username = $1`,
      [username.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const user = result.rows[0];

    // Check account is active
    if (!user.is_active) {
      return res.status(403).json({ success: false, error: "Account is disabled. Contact administrator." });
    }

    // Check password (plain text for now — will hash later)
    if (password !== user.password) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    // Check org name if provided
    if (org_name && org_name.trim().toLowerCase() !== user.org_name.toLowerCase()) {
      return res.status(401).json({ success: false, error: "Organisation name does not match." });
    }

    // Update last_login
    await pool.query(
      "UPDATE public.users SET last_login = $1 WHERE id = $2",
      [Date.now(), user.id]
    );

    // Issue JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, org: user.org_name },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    console.log(`[AUTH] Login: ${user.username} (${user.role}) from org "${user.org_name}"`);

    res.json({
      success: true,
      token,
      expiresIn: "8h",
      user: {
        id:       user.id,
        username: user.username,
        fullName: user.full_name,
        role:     user.role,
        org:      user.org_name,
      }
    });

  } catch (err) {
    console.error("[AUTH] Login error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/auth/verify
router.post("/verify", (req, res) => {
  const token = (req.headers["authorization"] || "").split(" ")[1];
  if (!token) return res.json({ valid: false });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, decoded });
  } catch {
    res.json({ valid: false });
  }
});

module.exports = router;
