const router = require("express").Router();
const { requireApiKey, requireAuth } = require("../middleware/auth");

// ─── DEVICE ENFORCEMENT LOG STREAM (IN-MEMORY, NOT PERSISTED) ───────────────────
// Real-time allow/block/VPN events sourced FROM THE DEVICE. A BYOD phone sits
// behind carrier NAT, so the dashboard can't open a socket to it directly — the
// device pushes its live log outbound instead. We deliberately DO NOT write these
// to the database: they live only in a short, in-memory ring buffer per device and
// the dashboard polls them back. On restart (or after a device goes idle) they
// simply evaporate — which is exactly what a live tail should do.

// empId -> array of { ts, package, blocked, kind } (oldest first)
const buffers = new Map();
// empId -> last time we heard from this device (for idle eviction)
const lastSeen = new Map();

const PER_DEVICE_CAP = 300;              // keep only the newest N events per device
const DEVICE_TTL_MS = 30 * 60 * 1000;    // drop a device's buffer after 30m idle
const MAX_BATCH = 500;                    // cap one push
let monotonic = 0;                        // stable ordering within the same ms

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
router.post("/", requireApiKey, (req, res) => {
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
    for (const l of logs.slice(0, MAX_BATCH)) {
      const ts = Number.isFinite(l.ts) ? Math.floor(l.ts) : now;
      const blocked = !!l.blocked;
      const pkg = l.package != null ? String(l.package).slice(0, 300) : null;
      const kind = l.kind ? String(l.kind).slice(0, 12) : (blocked ? "block" : "allow");
      buf.push({ seq: ++monotonic, ts, package: pkg, blocked, kind });
    }
    // Keep only the newest PER_DEVICE_CAP.
    if (buf.length > PER_DEVICE_CAP) buf.splice(0, buf.length - PER_DEVICE_CAP);
    buffers.set(empId, buf);

    res.json({ success: true, buffered: buf.length });
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

    res.json({ success: true, empId, live: buffers.has(empId), logs: out });
  } catch (err) {
    console.error("[DEVICE-LOGS] Fetch error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
