const router = require("express").Router();
const pool = require("../db/pool");
const { requireAuth, requireRole } = require("../middleware/auth");

// ─── PER-APP TIME-LIMIT POLICIES ───────────────────────────────────────────────
// An admin defines, per employee, which apps are allowed inside the zone and for
// how long per day. The APK reads these back via /api/agent-status/:empId.

// GET /api/policies/:empId
// Returns the employee's feature flags + all app policies (dashboard view).
router.get("/:empId", requireAuth, async (req, res) => {
  try {
    const { empId } = req.params;
    const agent = await pool.query(
      "SELECT feature_flags FROM public.agents WHERE emp_id = $1",
      [empId]
    );
    if (agent.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    const policies = await pool.query(
      `SELECT package, daily_limit_ms, enabled, updated_at
       FROM public.app_policies WHERE emp_id = $1 ORDER BY package`,
      [empId]
    );
    res.json({
      success: true,
      empId,
      feature_flags: agent.rows[0].feature_flags ?? {},
      policies: policies.rows.map((r) => ({
        package: r.package,
        daily_limit_ms: parseInt(r.daily_limit_ms, 10) || 0,
        enabled: r.enabled,
        updated_at: r.updated_at ? parseInt(r.updated_at, 10) : null,
      })),
    });
  } catch (err) {
    console.error("[POLICIES] Get error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/policies/:empId/app
// Body: { package, daily_limit_ms, enabled }
// Creates or updates one app's policy for this employee.
router.put("/:empId/app", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { empId } = req.params;
    const { package: pkg, daily_limit_ms, enabled } = req.body;
    if (!pkg || typeof pkg !== "string") {
      return res.status(400).json({ success: false, error: "package is required" });
    }
    const limit = Number.isFinite(daily_limit_ms) ? Math.max(0, Math.floor(daily_limit_ms)) : 0;
    const isEnabled = enabled === undefined ? true : !!enabled;

    const result = await pool.query(
      `INSERT INTO public.app_policies (emp_id, package, daily_limit_ms, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (emp_id, package) DO UPDATE SET
         daily_limit_ms = EXCLUDED.daily_limit_ms,
         enabled        = EXCLUDED.enabled,
         updated_at     = EXCLUDED.updated_at
       RETURNING package, daily_limit_ms, enabled`,
      [empId, pkg, limit, isEnabled, Date.now()]
    );
    res.json({ success: true, policy: result.rows[0] });
  } catch (err) {
    console.error("[POLICIES] Upsert app error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// DELETE /api/policies/:empId/app/:package
// Removes one app's policy for this employee.
router.delete("/:empId/app/:package", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { empId, package: pkg } = req.params;
    const result = await pool.query(
      "DELETE FROM public.app_policies WHERE emp_id = $1 AND package = $2 RETURNING package",
      [empId, pkg]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Policy not found" });
    }
    res.json({ success: true, deleted: result.rows[0].package });
  } catch (err) {
    console.error("[POLICIES] Delete error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// PUT /api/policies/:empId/feature-flags
// Body: { feature_flags: { ... } }  — sets the per-user "special key".
router.put("/:empId/feature-flags", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { empId } = req.params;
    const { feature_flags } = req.body;
    if (typeof feature_flags !== "object" || feature_flags === null || Array.isArray(feature_flags)) {
      return res.status(400).json({ success: false, error: "feature_flags must be an object" });
    }
    const result = await pool.query(
      "UPDATE public.agents SET feature_flags = $1::jsonb WHERE emp_id = $2 RETURNING emp_id, feature_flags",
      [JSON.stringify(feature_flags), empId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Agent not found" });
    }
    res.json({ success: true, agent: result.rows[0] });
  } catch (err) {
    console.error("[POLICIES] Feature-flags error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
