// Data retention — prunes NON-ESSENTIAL historical rows older than N days.
//
// Only append-only history is pruned; current-state tables (agents, users,
// system_settings, app_policies) are never touched. Runs once on startup and
// then daily. Configurable via DATA_RETENTION_DAYS (default 10).
//
//   app_usage    — per-day per-app usage history (dashboard usage table/metrics)
//   login_events — dashboard sign-in audit (metrics only)
//
// (Device enforcement logs are in-memory only, so there's nothing to prune here.)

const pool = require("./pool");

const RETENTION_DAYS = Math.max(1, parseInt(process.env.DATA_RETENTION_DAYS || "10", 10));
const DAY_MS = 24 * 60 * 60 * 1000;

// Captured device logs are only ever a short on-demand tail — pruned after 1 day
// regardless of DATA_RETENTION_DAYS (per product requirement). Resolved alerts
// are kept a few days for reference, then pruned.
const DEVICE_LOG_DAYS = 1;
const RESOLVED_ALERT_DAYS = 3;

async function runRetention() {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  const logCutoff = Date.now() - DEVICE_LOG_DAYS * DAY_MS;
  const alertCutoff = Date.now() - RESOLVED_ALERT_DAYS * DAY_MS;
  try {
    const usage = await pool.query("DELETE FROM public.app_usage WHERE recorded_at < $1", [cutoff]);
    const logins = await pool.query("DELETE FROM public.login_events WHERE ts < $1", [cutoff]);
    console.log(
      `🧹 Retention: pruned ${usage.rowCount} app_usage + ${logins.rowCount} login_events older than ${RETENTION_DAYS} days`
    );
    // Temporary device-log capture: hard 1-day cap.
    try {
      const dlogs = await pool.query("DELETE FROM public.device_logs WHERE created_at < $1", [logCutoff]);
      if (dlogs.rowCount) console.log(`🧹 Retention: pruned ${dlogs.rowCount} device_logs older than ${DEVICE_LOG_DAYS} day`);
    } catch (e) { /* table may not exist on older DB */ }
    // Old resolved alerts.
    try {
      const al = await pool.query(
        "DELETE FROM public.alerts WHERE resolved = true AND resolved_at < $1", [alertCutoff]
      );
      if (al.rowCount) console.log(`🧹 Retention: pruned ${al.rowCount} resolved alerts older than ${RESOLVED_ALERT_DAYS} days`);
    } catch (e) { /* table may not exist on older DB */ }
  } catch (err) {
    console.warn("[RETENTION] prune failed:", err.message);
  }
}

// Kick off an initial prune shortly after boot (so it doesn't compete with schema
// init), then repeat. Device-log capture needs a tighter cadence than daily so a
// 1-day cap is actually enforced within an hour — run hourly.
const RUN_EVERY_MS = 60 * 60 * 1000; // hourly
function startRetention() {
  setTimeout(runRetention, 15 * 1000);
  const t = setInterval(runRetention, RUN_EVERY_MS);
  if (typeof t.unref === "function") t.unref();
}

module.exports = { runRetention, startRetention };
