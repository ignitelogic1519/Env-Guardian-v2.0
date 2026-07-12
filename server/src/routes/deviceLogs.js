const router = require("express").Router();
const pool = require("../db/pool");
const { requireApiKey, requireAuth, requireRole } = require("../middleware/auth");

// ─── DEVICE ENFORCEMENT LOG STREAM ──────────────────────────────────────────────
// Real-time allow/block/VPN events sourced FROM THE DEVICE. A BYOD phone sits
// behind carrier NAT, so the dashboard can't open a socket to it directly — the
// device pushes its live log outbound instead. These always live in a short
// in-memory ring buffer per device that the dashboard polls back (evaporates on
// restart, which is exactly what a live tail should do).
//
// ON-DEMAND PERSISTENCE: when an admin flips "capture live logs" for a device
// (agents.log_capture = true) the pushed events are ALSO written to
// public.device_logs so the dashboard can show a history that survives a poll
// gap / server restart. Retention prunes device_logs older than 1 day, so this
// is a temporary capture, not a permanent store.

// empId -> array of { seq, ts, package, blocked, kind } (oldest first)
const buffers = new Map();
// empId -> last time we heard from this device (for idle eviction)
const lastSeen = new Map();

const PER_DEVICE_CAP = 300;              // keep only the newest N events per device
const DEVICE_TTL_MS = 30 * 60 * 1000;    // drop a device's buffer after 30m idle
const MAX_BATCH = 500;                    // cap one push
let monotonic = 0;                        // stable ordering within the same ms

// Small cache of which devices currently have live-log capture enabled, so a
// high-frequency ingest doesn't hit the DB on every push. Refreshed lazily.
let captureSet = new Set();
let captureLoadedAt = 0;
const CAPTURE_TTL_MS = 12000;
async function captureEnabled(empId) {
  const now = Date.now();
  if (now - captureLoadedAt > CAPTURE_TTL_MS) {
    try {
      const q = await pool.query("SELECT emp_id FROM public.agents WHERE log_capture = true");
      captureSet = new Set(q.rows.map((r) => r.emp_id));
      captureLoadedAt = now;
    } catch (_) { /* table/column may not exist yet — treat as none */ }
  }
  return captureSet.has(empId);
}
function markCapture(empId, on) {
  if (on) captureSet.add(empId); else captureSet.delete(empId);
}

// Evict devices we haven't heard from in a while so memory stays bounded.
function evictIdle(now) {
  for (const [id, ts] of lastSeen) {
    if (now - ts > DEVICE_TTL_MS) {
      lastSeen.delete(id);
      buffers.delete(id);
    }
  }
}

// POST /api/device-logs
// Body: { empId, logs: [{ package, blocked, time?, ts?, kind? }] }
router.post("/", requireApiKey, async (req, res) => {
  try {
    const empId = req.body.empId || req.body.emp_id;
    const logs = req.body.logs;
    if (!empId || !Array.isArray(logs)) {
      return res.status(400).json({ success: false, error: "empId and logs[] required" });
    }
    const now = Date.now();
    evictIdle(now);
    lastSeen.set(empId, now);

    if (logs.length === 0) return res.json({ success: true, buffered: (buffers.get(empId) || []).length });

    const buf = buffers.get(empId) || [];
    const persist = await captureEnabled(empId);
    const toPersist = [];
    for (const l of logs.slice(0, MAX_BATCH)) {
      const ts = Number.isFinite(l.ts) ? Math.floor(l.ts) : now;
      const blocked = !!l.blocked;
      const pkg = l.package != null ? String(l.package).slice(0, 300) : null;
      const kind = l.kind ? String(l.kind).slice(0, 12) : (blocked ? "block" : "allow");
      buf.push({ seq: ++monotonic, ts, package: pkg, blocked, kind });
      if (persist) toPersist.push({ ts, pkg, blocked, kind });
    }
    // Keep only the newest PER_DEVICE_CAP.
    if (buf.length > PER_DEVICE_CAP) buf.splice(0, buf.length - PER_DEVICE_CAP);
    buffers.set(empId, buf);

    // Best-effort DB persistence when capture is on for this device.
    if (toPersist.length) {
      try {
        const vals = [];
        const params = [];
        toPersist.forEach((r, i) => {
          const b = i * 5;
          vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
          params.push(empId, r.pkg, r.blocked, r.kind, r.ts);
        });
        await pool.query(
          `INSERT INTO public.device_logs (emp_id, package, blocked, kind, ts) VALUES ${vals.join(",")}`,
          params
        );
      } catch (e) { console.warn("[DEVICE-LOGS] persist failed:", e.message); }
    }

    res.json({ success: true, buffered: buf.length, captured: persist });
  } catch (err) {
    console.error("[DEVICE-LOGS] Ingest error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/device-logs/:empId?since=<ts>&limit=<n>
// Returns the in-memory buffer newest-first. With `since`, only rows strictly
// newer than that ts (for incremental polling); otherwise the newest `limit`.
router.get("/:empId", requireAuth, (req, res) => {
  try {
    const { empId } = req.params;
    const since = parseInt(req.query.since, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const buf = buffers.get(empId) || [];
    let rows = buf;
    if (Number.isFinite(since)) rows = rows.filter((r) => r.ts > since);
    // newest-first, capped
    const out = rows
      .slice()
      .sort((a, b) => b.ts - a.ts || b.seq - a.seq)
      .slice(0, limit)
      .map((r) => ({ id: r.seq, ts: r.ts, package: r.package, blocked: r.blocked, kind: r.kind }));

    res.json({ success: true, empId, live: buffers.has(empId), capturing: captureSet.has(empId), logs: out });
  } catch (err) {
    console.error("[DEVICE-LOGS] Fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/device-logs/:empId/capture — current capture flag.
router.get("/:empId/capture", requireAuth, async (req, res) => {
  try {
    const q = await pool.query("SELECT log_capture FROM public.agents WHERE emp_id = $1", [req.params.empId]);
    if (q.rows.length === 0) return res.status(404).json({ success: false, error: "Agent not found" });
    res.json({ success: true, capturing: !!q.rows[0].log_capture });
  } catch (err) {
    console.error("[DEVICE-LOGS] Capture-get error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// POST /api/device-logs/:empId/capture  Body: { enabled: boolean }
// Turns temporary DB capture on/off for a device (admin/manager).
router.post("/:empId/capture", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const { empId } = req.params;
    const enabled = !!req.body.enabled;
    const r = await pool.query(
      "UPDATE public.agents SET log_capture = $1 WHERE emp_id = $2 RETURNING emp_id",
      [enabled, empId]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: "Agent not found" });
    markCapture(empId, enabled);
    captureLoadedAt = 0; // force a refresh on the next ingest too
    console.log(`[DEVICE-LOGS] Capture ${enabled ? "ENABLED" : "disabled"} for ${empId}`);
    res.json({ success: true, capturing: enabled });
  } catch (err) {
    console.error("[DEVICE-LOGS] Capture-set error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/device-logs/:empId/history?limit=n — persisted capture (≤ 1 day).
router.get("/:empId/history", requireAuth, async (req, res) => {
  try {
    const { empId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    const q = await pool.query(
      `SELECT id, package, blocked, kind, ts FROM public.device_logs
       WHERE emp_id = $1 ORDER BY ts DESC LIMIT $2`,
      [empId, limit]
    );
    res.json({
      success: true,
      empId,
      capturing: captureSet.has(empId),
      logs: q.rows.map((r) => ({ id: r.id, ts: parseInt(r.ts, 10), package: r.package, blocked: r.blocked, kind: r.kind })),
    });
  } catch (err) {
    console.error("[DEVICE-LOGS] History error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
