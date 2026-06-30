const router = require("express").Router();
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

// Rotating-QR (feature G) helper. When qr_mode = 'totp', the valid QR value is a
// time-based code derived from qr_secret (30s window) instead of the static
// string. Server and app compute it identically. Default mode is 'static'.
const QR_PERIOD_SEC = 30;
function qrCodeForStep(secret, step) {
  return crypto.createHmac("sha256", String(secret)).update(String(step)).digest("hex").slice(0, 12).toUpperCase();
}
function currentQrValue(secret, mode) {
  if (mode !== "totp") return secret;
  const step = Math.floor(Date.now() / 1000 / QR_PERIOD_SEC);
  return qrCodeForStep(secret, step);
}

// GET /api/qr-current
// Returns the QR value to display right now (rotates when qr_mode = 'totp').
router.get("/qr-current", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT qr_secret, qr_mode FROM public.system_settings WHERE id = 1"
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "System settings not found" });
    }
    const { qr_secret, qr_mode } = result.rows[0];
    res.json({
      success: true,
      qr_string: currentQrValue(qr_secret, qr_mode),
      mode: qr_mode || "static",
      period: QR_PERIOD_SEC,
    });
  } catch (err) {
    console.error("[SETTINGS] QR fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/settings
// Returns non-sensitive system settings for dashboard
router.get("/settings", requireAuth, async (req, res) => {
  try {
    // Includes admin_password + qr_secret so the APK can sync them on startup.
    const result = await pool.query(
      "SELECT id, admin_password, geofence_polygon, whitelisted_apps, qr_secret, qr_mode, updated_at FROM public.system_settings WHERE id = 1"
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Settings not found" });
    }
    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    console.error("[SETTINGS] Get settings error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/geofence
// Body: { polygon: [{lat, lng}] }
router.put("/settings/geofence", requireAuth, async (req, res) => {
  try {
    const { polygon } = req.body;
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({ success: false, error: "polygon must be an array of at least 3 {lat,lng} points" });
    }

    const result = await pool.query(
      "UPDATE public.system_settings SET geofence_polygon = $1::jsonb, updated_at = $2 WHERE id = 1 RETURNING *",
      [JSON.stringify(polygon), Date.now()]
    );

    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    console.error("[SETTINGS] Update geofence error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/whitelisted-apps
// Body: { apps: string[] }
router.put("/settings/whitelisted-apps", requireAuth, async (req, res) => {
  try {
    const { apps } = req.body;
    if (!Array.isArray(apps)) {
      return res.status(400).json({ success: false, error: "apps must be an array of package names" });
    }

    const result = await pool.query(
      "UPDATE public.system_settings SET whitelisted_apps = $1::jsonb, updated_at = $2 WHERE id = 1 RETURNING id, whitelisted_apps",
      [JSON.stringify(apps), Date.now()]
    );

    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    console.error("[SETTINGS] Update whitelisted apps error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/admin-password
// Body: { oldPassword, password }
// Requires the current admin password before changing it.
router.put("/settings/admin-password", requireAuth, async (req, res) => {
  try {
    const { oldPassword, password } = req.body;
    if (!password || typeof password !== "string" || password.trim().length < 4) {
      return res.status(400).json({ success: false, error: "New password must be at least 4 characters" });
    }
    // Verify the current password matches before allowing the change.
    const cur = await pool.query("SELECT admin_password FROM public.system_settings WHERE id = 1");
    const current = cur.rows[0]?.admin_password;
    if (!oldPassword || oldPassword !== current) {
      return res.status(403).json({ success: false, error: "Current password is incorrect" });
    }
    await pool.query(
      "UPDATE public.system_settings SET admin_password = $1, updated_at = $2 WHERE id = 1",
      [password.trim(), Date.now()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[SETTINGS] Update admin password error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/qr-secret
// Body: { qr_secret }  — updates the zone QR code value
router.put("/settings/qr-secret", requireAuth, async (req, res) => {
  try {
    const { qr_secret } = req.body;
    if (!qr_secret || typeof qr_secret !== "string" || !qr_secret.trim()) {
      return res.status(400).json({ success: false, error: "qr_secret is required" });
    }
    const result = await pool.query(
      "UPDATE public.system_settings SET qr_secret = $1, updated_at = $2 WHERE id = 1 RETURNING qr_secret",
      [qr_secret.trim(), Date.now()]
    );
    res.json({ success: true, qr_secret: result.rows[0]?.qr_secret });
  } catch (err) {
    console.error("[SETTINGS] Update QR secret error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
