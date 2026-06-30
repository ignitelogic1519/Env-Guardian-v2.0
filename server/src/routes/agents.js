const router = require("express").Router();
const crypto = require("crypto");
const pool = require("../db/pool");
const { requireApiKey, requireAuth } = require("../middleware/auth");
const { enrichAgent } = require("../utils/agentMetrics");

// Feature F: per-device auth token. Issued at registration. Enforcement is
// OPT-IN via ENFORCE_DEVICE_TOKEN=true (so existing devices aren't locked out
// before they've obtained a token). When enforced, a device request whose
// agent has a token must present a matching x-device-token header.
const newDeviceToken = () => crypto.randomBytes(24).toString("hex");
function deviceTokenOk(req, agentRow) {
  if (String(process.env.ENFORCE_DEVICE_TOKEN).toLowerCase() !== "true") return true;
  if (!agentRow || !agentRow.device_token) return true; // no token yet → grace
  return req.headers["x-device-token"] === agentRow.device_token;
}

// The Flutter APK and the React dashboard historically used slightly different
// field names. These helpers accept either dialect so both clients integrate
// against the same routes.
const pick = (...vals) => vals.find((v) => v !== undefined);

// ─── APK ROUTES (device → server) ────────────────────────────────────────────

// POST /api/register
// Called by APK on first launch to register a device.
// Accepts both snake_case (emp_name) and camelCase (empName) bodies.
router.post("/register", requireApiKey, async (req, res) => {
  try {
    const emp_name     = pick(req.body.emp_name, req.body.empName);
    const emp_id       = pick(req.body.emp_id, req.body.empId);
    const device_id    = pick(req.body.device_id, req.body.deviceId);
    const device_model = pick(req.body.device_model, req.body.deviceModel);
    const android_version = pick(req.body.android_version, req.body.androidVersion);
    const sdk_int = pick(req.body.sdk_int, req.body.sdkInt);
    const registered_at = pick(req.body.registered_at, req.body.registeredAt, Date.now());

    if (!emp_name || !emp_id || !device_id || !device_model) {
      return res.status(400).json({ success: false, error: "Missing required fields", message: "Missing required fields" });
    }

    // ── SECURITY: a device is permanently bound to its first registered owner ──
    // If this device_id already exists, only the SAME identity (same emp_id +
    // same name) may re-register (e.g. an app reinstall). A different identity
    // is rejected — this prevents someone re-claiming a lost/stolen device under
    // a new name. An admin must delete the device first to re-assign it.
    const existing = await pool.query(
      "SELECT emp_id, emp_name, device_token FROM public.agents WHERE device_id = $1",
      [device_id]
    );
    if (existing.rows.length > 0) {
      const cur = existing.rows[0];
      const sameIdentity =
        String(cur.emp_id).trim() === String(emp_id).trim() &&
        String(cur.emp_name || "").trim().toLowerCase() === String(emp_name).trim().toLowerCase();
      if (!sameIdentity) {
        console.warn(`[AGENTS] Blocked re-registration of device ${device_id}: already bound to ${cur.emp_id}, attempted by ${emp_id}`);
        return res.status(409).json({
          success: false,
          error: "Device already registered",
          message: "This device is already registered to another employee. Contact your administrator.",
        });
      }
      // Same person re-registering (e.g. reinstall): refresh metadata, keep the
      // binding, and keep the existing token (issue one if it never had one).
      const token = cur.device_token || newDeviceToken();
      const upd = await pool.query(
        `UPDATE public.agents SET
           device_model    = $2,
           android_version = $3,
           sdk_int         = $4,
           last_pulse      = $5,
           device_token    = $6
         WHERE device_id = $1
         RETURNING *`,
        [device_id, device_model, android_version ?? null, sdk_int ?? null, registered_at, token]
      );
      return res.status(201).json({ success: true, agent: upd.rows[0] });
    }

    // New device → insert with a fresh device token. (emp_id is UNIQUE, so a
    // duplicate emp_id on a different device is rejected by the catch below.)
    const result = await pool.query(
      `INSERT INTO public.agents
         (emp_name, emp_id, device_id, device_model, android_version, sdk_int, registered_at, last_pulse, device_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
       RETURNING *`,
      [emp_name, emp_id, device_id, device_model, android_version ?? null, sdk_int ?? null, registered_at, newDeviceToken()]
    );

    // APK expects HTTP 201 on a successful registration.
    res.status(201).json({ success: true, agent: result.rows[0] });
  } catch (err) {
    // Unique-violation (e.g. emp_id already used by another device) → 409.
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "Already registered",
        message: "This employee ID or device is already registered. Contact your administrator.",
      });
    }
    console.error("[AGENTS] Register error:", err.message);
    res.status(500).json({ success: false, error: "Server error", message: err.message });
  }
});

// POST /api/heartbeat
// Called by APK every ~10s to report device status.
// Accepts both dialects and identifies the device by device_id OR emp_id.
router.post("/heartbeat", requireApiKey, async (req, res) => {
  try {
    const device_id   = pick(req.body.device_id, req.body.deviceId);
    const emp_id      = pick(req.body.emp_id, req.body.empId);
    const current_lat = pick(req.body.current_lat, req.body.lat);
    const current_lng = pick(req.body.current_lng, req.body.lng);
    const in_zone     = pick(req.body.in_zone, req.body.inZone);
    const compliance  = pick(req.body.compliance_status, req.body.compliance);
    const installed   = pick(req.body.installed_apps, req.body.installedApps);
    const enforcer    = pick(req.body.enforcer_active, req.body.enforcerActive);
    const auto_lock   = pick(req.body.auto_lock, req.body.autoLock);
    const android_version = pick(req.body.android_version, req.body.androidVersion);
    const sdk_int     = pick(req.body.sdk_int, req.body.sdkInt);

    if (!device_id && !emp_id) {
      return res.status(400).json({ success: false, error: "device_id or empId is required" });
    }

    const now = Date.now();
    // Match by device_id when present, otherwise fall back to emp_id.
    const matchCol = device_id ? "device_id" : "emp_id";
    const matchVal = device_id || emp_id;

    const result = await pool.query(
      `UPDATE public.agents SET
         current_lat       = COALESCE($2, current_lat),
         current_lng       = COALESCE($3, current_lng),
         in_zone           = COALESCE($4, in_zone),
         compliance_status = COALESCE($5::jsonb, compliance_status),
         installed_apps    = COALESCE($6::jsonb, installed_apps),
         enforcer_active   = COALESCE($7, enforcer_active),
         auto_lock         = COALESCE($8, auto_lock),
         android_version   = COALESCE($10, android_version),
         sdk_int           = COALESCE($11, sdk_int),
         last_pulse        = $9
       WHERE ${matchCol} = $1
       RETURNING id, emp_name, emp_id, device_id, last_pulse, admin_lock, auto_lock, device_token`,
      [
        matchVal,
        current_lat ?? null,
        current_lng ?? null,
        in_zone ?? null,
        compliance ? JSON.stringify(compliance) : null,
        installed ? JSON.stringify(installed) : null,
        enforcer ?? null,
        auto_lock ?? null,
        now,
        android_version ?? null,
        sdk_int ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Device not registered" });
    }

    const agent = result.rows[0];
    if (!deviceTokenOk(req, agent)) {
      return res.status(403).json({ success: false, error: "Invalid device token" });
    }
    res.json({
      success: true,
      last_pulse: now,
      admin_lock: agent.admin_lock, // APK checks this to enforce lock
      auto_lock: agent.auto_lock,
    });
  } catch (err) {
    console.error("[AGENTS] Heartbeat error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/qr-verify
// Called by APK after user scans QR code
router.post("/qr-verify", requireApiKey, async (req, res) => {
  try {
    const device_id = pick(req.body.device_id, req.body.deviceId);
    const emp_id    = pick(req.body.emp_id, req.body.empId);
    const qr_secret = pick(req.body.qr_secret, req.body.qrSecret);
    if ((!device_id && !emp_id) || !qr_secret) {
      return res.status(400).json({ success: false, error: "device_id/empId and qr_secret required" });
    }

    const settings = await pool.query(
      "SELECT qr_secret FROM public.system_settings WHERE id = 1"
    );
    const validSecret = settings.rows[0]?.qr_secret;
    if (!validSecret || qr_secret !== validSecret) {
      return res.json({ success: false, verified: false });
    }

    const matchCol = device_id ? "device_id" : "emp_id";
    await pool.query(
      `UPDATE public.agents
       SET compliance_status = COALESCE(compliance_status, '{}'::jsonb) || '{"qr_verified": true}'::jsonb
       WHERE ${matchCol} = $1`,
      [device_id || emp_id]
    );

    res.json({ success: true, verified: true });
  } catch (err) {
    console.error("[AGENTS] QR verify error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/agent-status/:empId
// Called by APK to read back admin_lock + custom_whitelist (two-way sync).
router.get("/agent-status/:empId", requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT admin_lock, auto_lock, custom_whitelist, feature_flags, device_token
       FROM public.agents WHERE emp_id = $1`,
      [req.params.empId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    const row = result.rows[0];
    if (!deviceTokenOk(req, row)) {
      return res.status(403).json({ success: false, error: "Invalid device token" });
    }

    // Per-app time-limit policy for this employee (only the enabled rows).
    const pol = await pool.query(
      `SELECT package, daily_limit_ms, enabled
       FROM public.app_policies WHERE emp_id = $1`,
      [req.params.empId]
    );

    res.json({
      success: true,
      admin_lock: row.admin_lock ?? false,
      auto_lock: row.auto_lock ?? false,
      custom_whitelist: row.custom_whitelist ?? [],
      feature_flags: row.feature_flags ?? {},
      app_policies: pol.rows.map((r) => ({
        package: r.package,
        daily_limit_ms: parseInt(r.daily_limit_ms, 10) || 0,
        enabled: r.enabled,
      })),
    });
  } catch (err) {
    console.error("[AGENTS] Agent-status error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/clear-auto-lock
// Called by APK after a valid admin password unfreezes a device.
router.post("/clear-auto-lock", requireApiKey, async (req, res) => {
  try {
    const empId = pick(req.body.empId, req.body.emp_id);
    if (!empId) return res.status(400).json({ success: false, error: "empId required" });
    await pool.query(
      "UPDATE public.agents SET auto_lock = false WHERE emp_id = $1",
      [empId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[AGENTS] Clear auto-lock error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/update-whitelist
// Called by APK (custom_whitelist) — alias of the dashboard route.
router.post("/update-whitelist", requireAuth, async (req, res) => {
  try {
    const empId = pick(req.body.empId, req.body.emp_id);
    const whitelist = pick(req.body.custom_whitelist, req.body.whitelist);
    if (!empId || !Array.isArray(whitelist)) {
      return res.status(400).json({ success: false, error: "empId and whitelist[] required" });
    }
    const result = await pool.query(
      "UPDATE public.agents SET custom_whitelist = $1::jsonb WHERE emp_id = $2 RETURNING emp_id, custom_whitelist",
      [JSON.stringify(whitelist), empId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    res.json({ success: true, agent: result.rows[0] });
  } catch (err) {
    console.error("[AGENTS] Update whitelist error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ─── DASHBOARD ROUTES (admin console → server) ────────────────────────────────

// GET /api/dashboard/agents
// Returns all agents (enriched with derived metrics) for dashboard display.
router.get("/dashboard/agents", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id, emp_name, emp_id, device_id, device_model,
         android_version, sdk_int,
         registered_at, current_lat, current_lng, in_zone,
         enforcer_active, last_pulse, installed_apps,
         admin_lock, auto_lock, compliance_status, custom_whitelist,
         user_id, employee_id
       FROM public.agents
       ORDER BY last_pulse DESC NULLS LAST`
    );
    res.json({ success: true, agents: result.rows.map(enrichAgent) });
  } catch (err) {
    console.error("[DASHBOARD] Get agents error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/dashboard/agents/:empId
// Returns single agent details (enriched).
router.get("/dashboard/agents/:empId", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM public.agents WHERE emp_id = $1",
      [req.params.empId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    res.json({ success: true, agent: enrichAgent(result.rows[0]) });
  } catch (err) {
    console.error("[DASHBOARD] Get agent error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/dashboard/toggle-lock
// Body: { empId, lockStatus: boolean }
router.post("/dashboard/toggle-lock", requireAuth, async (req, res) => {
  try {
    const { empId, lockStatus } = req.body;
    if (empId === undefined || lockStatus === undefined) {
      return res.status(400).json({ success: false, error: "empId and lockStatus required" });
    }

    const result = await pool.query(
      "UPDATE public.agents SET admin_lock = $1 WHERE emp_id = $2 RETURNING emp_id, emp_name, admin_lock",
      [lockStatus, empId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }

    console.log(`[DASHBOARD] Device ${empId} lock set to ${lockStatus}`);
    res.json({ success: true, agent: result.rows[0] });
  } catch (err) {
    console.error("[DASHBOARD] Toggle lock error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /api/dashboard/agents/:empId
// Permanently removes a device (and its app-usage history) from the database.
router.delete("/dashboard/agents/:empId", requireAuth, async (req, res) => {
  try {
    const { empId } = req.params;
    // Remove dependent app-usage rows first (no FK, so clean up manually).
    await pool.query("DELETE FROM public.app_usage WHERE emp_id = $1", [empId]);
    const result = await pool.query(
      "DELETE FROM public.agents WHERE emp_id = $1 RETURNING emp_id, emp_name",
      [empId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    console.log(`[DASHBOARD] Device ${empId} deleted`);
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error("[DASHBOARD] Delete agent error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/dashboard/update-whitelist
// Body: { empId, whitelist: string[] }
router.post("/dashboard/update-whitelist", requireAuth, async (req, res) => {
  try {
    const { empId, whitelist } = req.body;
    if (!empId || !Array.isArray(whitelist)) {
      return res.status(400).json({ success: false, error: "empId and whitelist[] required" });
    }

    const result = await pool.query(
      "UPDATE public.agents SET custom_whitelist = $1::jsonb WHERE emp_id = $2 RETURNING emp_id, custom_whitelist",
      [JSON.stringify(whitelist), empId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }

    res.json({ success: true, agent: result.rows[0] });
  } catch (err) {
    console.error("[DASHBOARD] Update whitelist error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
