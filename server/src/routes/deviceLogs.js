const router = require("express").Router();
const pool = require("../db/pool");
const { requireApiKey, requireAuth } = require("../middleware/auth");

// ─── DEVICE ENFORCEMENT LOG STREAM ─────────────────────────────────────────────
// The APK batches its native allow/block/VPN events and pushes them here; the
// dashboard polls them back per device to show a real-time "Live logs" feed.

// How long to retain a device's logs (older rows are pruned on ingest).
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
// Hard cap on how many rows one push may add (defensive).
const MAX_BATCH = 500;

// POST /api/device-logs
// Body: { empId, logs: [{ package, blocked, time?, ts?, kind? }] }
router.post("/", requireApiKey, async (req, res) => {
  try {
    const empId = req.body.empId || req.body.emp_id;
    const logs = req.body.logs;
    if (!empId || !Array.isArray(logs)) {
      return res.status(400).json({ success: false, error: "empId and logs[] required" });
    }
    if (logs.length === 0) return res.json({ success: true, inserted: 0 });

    const now = Date.now();
    const rows = logs.slice(0, MAX_BATCH).map((l) => {
      const ts = Number.isFinite(l.ts) ? Math.floor(l.ts) : now;
      const blocked = !!l.blocked;
      const pkg = l.package != null ? String(l.package).slice(0, 300) : null;
      // 'vpn' rows carry a human message in `package`; otherwise it's allow/block.
      const kind = l.kind ? String(l.kind).slice(0, 12) : (blocked ? "block" : "allow");
      return { ts, blocked, pkg, kind };
    });

    // Build a single multi-row insert.
    const values = [];
    const params = [];
    rows.forEach((r, i) => {
      const b = i * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      params.push(empId, r.ts, r.pkg, r.blocked, r.kind);
    });
    await pool.query(
      `INSERT INTO public.device_logs (emp_id, ts, package, blocked, kind) VALUES ${values.join(", ")}`,
      params
    );

    // Prune this device's old rows so the table stays bounded (best-effort).
    pool
      .query("DELETE FROM public.device_logs WHERE emp_id = $1 AND ts < $2", [empId, now - RETENTION_MS])
      .catch(() => {});

    res.json({ success: true, inserted: rows.length });
  } catch (err) {
    console.error("[DEVICE-LOGS] Ingest error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/device-logs/:empId?since=<ts>&limit=<n>
// Returns logs newest-first. With `since`, only rows strictly newer than that ts
// (for incremental polling); otherwise the most recent `limit` rows.
router.get("/:empId", requireAuth, async (req, res) => {
  try {
    const { empId } = req.params;
    const since = parseInt(req.query.since, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    let result;
    if (Number.isFinite(since)) {
      result = await pool.query(
        `SELECT id, ts, package, blocked, kind
         FROM public.device_logs
         WHERE emp_id = $1 AND ts > $2
         ORDER BY ts DESC, id DESC LIMIT $3`,
        [empId, since, limit]
      );
    } else {
      result = await pool.query(
        `SELECT id, ts, package, blocked, kind
         FROM public.device_logs
         WHERE emp_id = $1
         ORDER BY ts DESC, id DESC LIMIT $2`,
        [empId, limit]
      );
    }

    res.json({
      success: true,
      empId,
      logs: result.rows.map((r) => ({
        id: r.id,
        ts: parseInt(r.ts, 10),
        package: r.package,
        blocked: r.blocked,
        kind: r.kind,
      })),
    });
  } catch (err) {
    console.error("[DEVICE-LOGS] Fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
