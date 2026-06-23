const router = require("express").Router();
const pool   = require("../db/pool");
const { requireApiKey, requireAuth } = require("../middleware/auth");

// ─── APK → SERVER ─────────────────────────────────────────────────────────────

// POST /api/app-usage
// Called by APK every heartbeat when device is in restricted zone
// Body: { empId, timestamp, date, usage: [{package, totalTimeMs, lastUsed}] }
router.post("/", requireApiKey, async (req, res) => {
  try {
    const { empId, date, usage } = req.body;
    if (!empId || !date || !Array.isArray(usage) || usage.length === 0) {
      return res.status(400).json({ success: false, error: "empId, date and usage[] required" });
    }

    // Upsert each app's usage — update if higher (device may send multiple times per day)
    for (const u of usage) {
      if (!u.package || typeof u.totalTimeMs !== "number") continue;
      await pool.query(
        `INSERT INTO public.app_usage (emp_id, date, package, total_ms, last_used, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (emp_id, date, package)
         DO UPDATE SET
           total_ms    = GREATEST(app_usage.total_ms, EXCLUDED.total_ms),
           last_used   = GREATEST(app_usage.last_used, EXCLUDED.last_used),
           recorded_at = EXCLUDED.recorded_at`,
        [empId, date, u.package, u.totalTimeMs, u.lastUsed || 0, Date.now()]
      );
    }

    res.json({ success: true, recorded: usage.length });
  } catch (err) {
    console.error("[APP-USAGE] POST error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ─── DASHBOARD → SERVER ────────────────────────────────────────────────────────

// GET /api/app-usage/:empId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Returns app usage for a device filtered by date range
router.get("/:empId", requireAuth, async (req, res) => {
  try {
    const { empId } = req.params;
    const { startDate, endDate } = req.query;

    // Default: today
    const today = new Date().toISOString().substring(0, 10);
    const start = startDate || today;
    const end   = endDate   || today;

    const result = await pool.query(
      `SELECT
         emp_id, date, package, total_ms, last_used, recorded_at
       FROM public.app_usage
       WHERE emp_id = $1
         AND date BETWEEN $2 AND $3
       ORDER BY date DESC, total_ms DESC`,
      [empId, start, end]
    );

    // Group by date for easy frontend rendering
    const grouped = {};
    for (const row of result.rows) {
      const d = row.date instanceof Date
        ? row.date.toISOString().substring(0, 10)
        : String(row.date).substring(0, 10);
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push({
        package:    row.package,
        totalMs:    parseInt(row.total_ms),
        lastUsed:   parseInt(row.last_used),
        recordedAt: parseInt(row.recorded_at),
      });
    }

    res.json({ success: true, empId, startDate: start, endDate: end, data: grouped });
  } catch (err) {
    console.error("[APP-USAGE] GET error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/app-usage/summary/all?date=YYYY-MM-DD
// Returns usage summary for ALL devices on a given date (for dashboard overview)
router.get("/summary/all", requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().substring(0, 10);
    const date  = req.query.date || today;

    const result = await pool.query(
      `SELECT
         a.emp_id,
         ag.emp_name,
         a.package,
         a.total_ms,
         a.last_used
       FROM public.app_usage a
       LEFT JOIN public.agents ag ON ag.emp_id = a.emp_id
       WHERE a.date = $1
       ORDER BY a.emp_id, a.total_ms DESC`,
      [date]
    );

    res.json({ success: true, date, rows: result.rows });
  } catch (err) {
    console.error("[APP-USAGE] Summary error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;
