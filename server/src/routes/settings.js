const router = require("express").Router();
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");

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
      `SELECT id, admin_password, geofence_polygon, whitelisted_apps, qr_secret, qr_mode, updated_at,
              shift_start, shift_hours, qr_alert_minutes, qr_reminder_minutes,
              battery_alert_pct, battery_notify_step
       FROM public.system_settings WHERE id = 1`
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
router.put("/settings/geofence", requireAuth, requireRole("admin", "manager"), async (req, res) => {
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
//
// The global whitelist lives in the single settings row (id = 1). Historically
// this was a plain UPDATE ... WHERE id = 1, which silently affected ZERO rows —
// and still returned success — on any database whose settings row hadn't been
// seeded at id = 1 (schema drift / a partially-provisioned DB). That is exactly
// the "dashboard says saved but nothing persists" symptom. We now UPSERT so the
// write always lands, and we verify a row actually changed before reporting ok.
router.put("/settings/whitelisted-apps", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { apps } = req.body;
    if (!Array.isArray(apps)) {
      return res.status(400).json({ success: false, error: "apps must be an array of package names" });
    }
    // Reject anything that isn't a clean list of package-name strings.
    const clean = apps.filter((a) => typeof a === "string").map((a) => a.trim()).filter(Boolean);

    const result = await pool.query(
      `INSERT INTO public.system_settings (id, whitelisted_apps, updated_at, admin_password, geofence_polygon, qr_secret)
         VALUES (1, $1::jsonb, $2,
                 COALESCE((SELECT admin_password   FROM public.system_settings WHERE id = 1), $3),
                 COALESCE((SELECT geofence_polygon FROM public.system_settings WHERE id = 1), '[]'::jsonb),
                 COALESCE((SELECT qr_secret        FROM public.system_settings WHERE id = 1), $4))
       ON CONFLICT (id) DO UPDATE SET
         whitelisted_apps = EXCLUDED.whitelisted_apps,
         updated_at       = EXCLUDED.updated_at
       RETURNING id, whitelisted_apps`,
      [JSON.stringify(clean), Date.now(),
       process.env.ADMIN_PASSWORD || "FoldedSteel2026",
       process.env.QR_SECRET || process.env.API_KEY || "FoldedSteelSecret2026"]
    );

    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, error: "Whitelist was not saved (no row affected)" });
    }
    console.log(`[SETTINGS] Global whitelist saved (${clean.length} apps)`);
    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    console.error("[SETTINGS] Update whitelisted apps error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/admin-password
// Body: { oldPassword, password }
// Requires the current admin password before changing it.
router.put("/settings/admin-password", requireAuth, requireRole("admin"), async (req, res) => {
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
router.put("/settings/qr-secret", requireAuth, requireRole("admin"), async (req, res) => {
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

// PUT /api/settings/alert-config
// Body (all optional): { shift_start: "HH:MM", shift_hours, qr_alert_minutes,
//                        qr_reminder_minutes, battery_alert_pct, battery_notify_step }
// Admin-tunable knobs: the shift window that per-app time budgets reset on, the
// "in zone but QR not scanned" alert threshold, the on-device QR reminder
// cadence, and the low-battery notification threshold/step.
router.put("/settings/alert-config", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const b = req.body || {};
    const updates = [];
    const params = [];
    const num = (v) => (v === undefined || v === null || v === "" ? undefined : Math.floor(Number(v)));
    const addNum = (col, v, min, max) => {
      if (v === undefined) return true;
      if (!Number.isFinite(v) || v < min || v > max) return false;
      params.push(v);
      updates.push(`${col} = $${params.length}`);
      return true;
    };

    if (b.shift_start !== undefined) {
      if (typeof b.shift_start !== "string" || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(b.shift_start.trim())) {
        return res.status(400).json({ success: false, error: "shift_start must be HH:MM (24h)" });
      }
      params.push(b.shift_start.trim());
      updates.push(`shift_start = $${params.length}`);
    }
    if (!addNum("shift_hours", num(b.shift_hours), 1, 24)) {
      return res.status(400).json({ success: false, error: "shift_hours must be 1–24" });
    }
    if (!addNum("qr_alert_minutes", num(b.qr_alert_minutes), 1, 1440)) {
      return res.status(400).json({ success: false, error: "qr_alert_minutes must be 1–1440" });
    }
    if (!addNum("qr_reminder_minutes", num(b.qr_reminder_minutes), 1, 240)) {
      return res.status(400).json({ success: false, error: "qr_reminder_minutes must be 1–240" });
    }
    if (!addNum("battery_alert_pct", num(b.battery_alert_pct), 1, 90)) {
      return res.status(400).json({ success: false, error: "battery_alert_pct must be 1–90" });
    }
    if (!addNum("battery_notify_step", num(b.battery_notify_step), 1, 20)) {
      return res.status(400).json({ success: false, error: "battery_notify_step must be 1–20" });
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: "No settings provided" });
    }

    params.push(Date.now());
    updates.push(`updated_at = $${params.length}`);
    const result = await pool.query(
      `UPDATE public.system_settings SET ${updates.join(", ")} WHERE id = 1
       RETURNING shift_start, shift_hours, qr_alert_minutes, qr_reminder_minutes,
                 battery_alert_pct, battery_notify_step`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(500).json({ success: false, error: "Settings row missing (id = 1)" });
    }
    console.log("[SETTINGS] Alert/shift config saved:", result.rows[0]);
    res.json({ success: true, settings: result.rows[0] });
  } catch (err) {
    console.error("[SETTINGS] Update alert-config error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/settings/qr-mode
// Body: { qr_mode: 'static' | 'totp' }  — feature G rotation toggle
router.put("/settings/qr-mode", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { qr_mode } = req.body;
    if (!["static", "totp"].includes(qr_mode)) {
      return res.status(400).json({ success: false, error: "qr_mode must be 'static' or 'totp'" });
    }
    const result = await pool.query(
      "UPDATE public.system_settings SET qr_mode = $1, updated_at = $2 WHERE id = 1 RETURNING qr_mode",
      [qr_mode, Date.now()]
    );
    res.json({ success: true, qr_mode: result.rows[0]?.qr_mode });
  } catch (err) {
    console.error("[SETTINGS] Update QR mode error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
