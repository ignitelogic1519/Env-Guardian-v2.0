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

async function runRetention() {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  try {
    const usage = await pool.query("DELETE FROM public.app_usage WHERE recorded_at < $1", [cutoff]);
    const logins = await pool.query("DELETE FROM public.login_events WHERE ts < $1", [cutoff]);
    console.log(
      `🧹 Retention: pruned ${usage.rowCount} app_usage + ${logins.rowCount} login_events older than ${RETENTION_DAYS} days`
    );
  } catch (err) {
    console.warn("[RETENTION] prune failed:", err.message);
  }
}

// Kick off an initial prune shortly after boot (so it doesn't compete with schema
// init), then repeat once a day. The timer is unref'd so it never keeps the
// process alive on its own.
function startRetention() {
  setTimeout(runRetention, 15 * 1000);
  const t = setInterval(runRetention, DAY_MS);
  if (typeof t.unref === "function") t.unref();
}

module.exports = { runRetention, startRetention };
