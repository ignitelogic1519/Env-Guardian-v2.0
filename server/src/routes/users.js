const router = require("express").Router();
const pool = require("../db/pool");
const { requireJWT, requireRole } = require("../middleware/auth");

// ─── DASHBOARD USER MANAGEMENT (admin only) ──────────────────────────────────
// Dashboard logins live in public.users with a role of admin / manager / viewer.
// Only admins may list or modify them; these routes require a JWT (never the
// device API key) so a leaked APK key can't manage console accounts.

const VALID_ROLES = ["admin", "manager", "viewer"];

// GET /api/users — list dashboard users (passwords never returned)
router.get("/", requireJWT, requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, org_name, username, role, full_name, is_active,
              created_at, last_login, email, department, employee_id, avatar_initials
       FROM public.users ORDER BY id`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error("[USERS] List error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/users — create a dashboard user
// Body: { username, password, role, full_name?, email?, department? }
router.post("/", requireJWT, requireRole("admin"), async (req, res) => {
  try {
    const { username, password, role, full_name, email, department } = req.body;
    if (!username || !password || !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `username, password and role (${VALID_ROLES.join("/")}) are required`,
      });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }
    const initials = (full_name || username)
      .split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const result = await pool.query(
      `INSERT INTO public.users (org_name, username, password, role, full_name, is_active, email, department, avatar_initials)
       VALUES ('Env Guardian', $1, $2, $3, $4, true, $5, $6, $7)
       RETURNING id, username, role, full_name, is_active, email, department, avatar_initials, created_at`,
      [username.trim(), password, role, full_name || null, email || null, department || null, initials]
    );
    console.log(`[USERS] Created ${username} (${role}) by ${req.admin.username}`);
    res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, error: "Username already exists" });
    }
    console.error("[USERS] Create error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/users/:id — update role / active state / password / profile fields
router.put("/:id", requireJWT, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { role, is_active, password, full_name, email, department } = req.body;

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, error: `role must be one of ${VALID_ROLES.join("/")}` });
    }
    if (password !== undefined && String(password).length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }
    // An admin can't deactivate or demote their own account (lockout guard).
    if (id === req.admin.id && (is_active === false || (role && role !== "admin"))) {
      return res.status(400).json({ success: false, error: "You cannot demote or deactivate your own account" });
    }

    const result = await pool.query(
      `UPDATE public.users SET
         role       = COALESCE($2, role),
         is_active  = COALESCE($3, is_active),
         password   = COALESCE($4, password),
         full_name  = COALESCE($5, full_name),
         email      = COALESCE($6, email),
         department = COALESCE($7, department)
       WHERE id = $1
       RETURNING id, username, role, full_name, is_active, email, department`,
      [id, role ?? null, is_active ?? null, password ?? null, full_name ?? null, email ?? null, department ?? null]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    console.log(`[USERS] Updated user #${id} by ${req.admin.username}`);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("[USERS] Update error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /api/users/:id — remove a dashboard login
router.delete("/:id", requireJWT, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.admin.id) {
      return res.status(400).json({ success: false, error: "You cannot delete your own account" });
    }
    const result = await pool.query(
      "DELETE FROM public.users WHERE id = $1 RETURNING id, username",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    console.log(`[USERS] Deleted ${result.rows[0].username} by ${req.admin.username}`);
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error("[USERS] Delete error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
