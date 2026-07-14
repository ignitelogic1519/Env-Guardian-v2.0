// Fleet risk alerts.
//
// The dashboard needs to surface risk conditions the moment a device trips them:
//   • a device inside the restricted zone that goes OFFLINE — the classic tamper
//     trap (app uninstalled, or the user cut internet access to stop heartbeats).
//     Reported HIGH risk (covers "offline in zone" + "internet cut off").
//   • a device reporting LOW BATTERY — reported LOW risk (the enforcer dies when
//     the phone dies, so it's worth a heads-up).
//   • Network Guard (VPN) disabled by the user while in-zone — MEDIUM tamper.
//   • a device inside the zone that hasn't scanned the entrance QR for longer
//     than the admin-set threshold (default 20 min) — LOW risk.
//
// Alerts are DEDUPLICATED: while an alert of the same (emp_id, type) is still
// unresolved we bump its updated_at instead of inserting a duplicate. When the
// condition clears the matching open alert(s) auto-resolve. A periodic sweep
// evaluates the whole fleet so alerts appear even when a device stops calling in.

const pool = require("./pool");

// A device is considered offline this long after its last heartbeat. Slightly
// longer than the dashboard's 2-min online window so a single missed pulse
// doesn't flap an alert on/off.
const OFFLINE_MS = 150000;          // 2.5 min
const LOW_BATTERY_PCT = 15;         // fallback if system_settings is unreadable
const QR_ALERT_MINUTES = 20;        // fallback for the QR-not-scanned threshold
const SWEEP_MS = 30000;             // evaluate the fleet every 30s

// Admin-tunable thresholds (dashboard → Settings → Alerts & shift). Read fresh
// each sweep so a change applies within ~30s without a restart.
async function loadAlertConfig() {
  const cfg = { lowBatteryPct: LOW_BATTERY_PCT, qrAlertMinutes: QR_ALERT_MINUTES };
  try {
    const q = await pool.query(
      "SELECT battery_alert_pct, qr_alert_minutes FROM public.system_settings WHERE id = 1"
    );
    const r = q.rows[0];
    if (r) {
      const batt = parseInt(r.battery_alert_pct, 10);
      const qr = parseInt(r.qr_alert_minutes, 10);
      if (Number.isFinite(batt) && batt > 0) cfg.lowBatteryPct = batt;
      if (Number.isFinite(qr) && qr > 0) cfg.qrAlertMinutes = qr;
    }
  } catch (_) { /* columns may not exist yet on an old DB — use fallbacks */ }
  return cfg;
}

// Raise (or refresh) an alert. No-op-safe: if the alerts table is missing on an
// older DB the error is swallowed so it never breaks a heartbeat/sweep.
async function raiseAlert({ emp_id, emp_name, type, severity = "medium", message, meta }) {
  try {
    const now = Date.now();
    const open = await pool.query(
      "SELECT id FROM public.alerts WHERE emp_id = $1 AND type = $2 AND resolved = false LIMIT 1",
      [emp_id, type]
    );
    if (open.rows.length > 0) {
      await pool.query(
        `UPDATE public.alerts
           SET updated_at = $2, message = $3, severity = $4,
               meta = COALESCE($5::jsonb, meta), emp_name = COALESCE($6, emp_name)
         WHERE id = $1`,
        [open.rows[0].id, now, message ?? null, severity, meta ? JSON.stringify(meta) : null, emp_name ?? null]
      );
      return { raised: false, updated: true };
    }
    await pool.query(
      `INSERT INTO public.alerts (emp_id, emp_name, type, severity, message, meta, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$7)`,
      [emp_id ?? null, emp_name ?? null, type, severity, message ?? null, meta ? JSON.stringify(meta) : null, now]
    );
    return { raised: true, updated: false };
  } catch (err) {
    console.warn("[ALERTS] raise failed:", err.message);
    return { raised: false, updated: false };
  }
}

// Auto-resolve any open alert(s) of a type for a device once the condition clears.
async function resolveAlerts(emp_id, type) {
  try {
    const now = Date.now();
    await pool.query(
      `UPDATE public.alerts SET resolved = true, resolved_at = $3, updated_at = $3
       WHERE emp_id = $1 AND type = $2 AND resolved = false`,
      [emp_id, type, now]
    );
  } catch (err) {
    console.warn("[ALERTS] resolve failed:", err.message);
  }
}

// Evaluate the whole fleet and raise/clear alerts accordingly.
async function sweepFleet() {
  try {
    const now = Date.now();
    const cfg = await loadAlertConfig();
    const { rows } = await pool.query(
      `SELECT emp_id, emp_name, in_zone, in_zone_since, last_pulse, enforcer_active,
              battery_level, battery_charging, compliance_status
       FROM public.agents`
    );
    for (const a of rows) {
      const lastPulse = parseInt(a.last_pulse, 10) || 0;
      const offline = !lastPulse || now - lastPulse > OFFLINE_MS;

      // ── HIGH: offline while inside the restricted zone ──────────────────────
      // The device was last known to be in-zone but has stopped reporting — the
      // app may have been uninstalled or internet access cut to escape the zone
      // policy. This is the single most important tamper signal.
      if (a.in_zone && offline) {
        const mins = lastPulse ? Math.round((now - lastPulse) / 60000) : null;
        await raiseAlert({
          emp_id: a.emp_id, emp_name: a.emp_name,
          type: "offline_in_zone", severity: "high",
          message: `Device went OFFLINE while inside the restricted zone${mins != null ? ` (silent ${mins} min)` : ""}. Possible uninstall or internet cut-off — investigate.`,
          meta: { last_pulse: lastPulse, minutes_silent: mins },
        });
      } else {
        await resolveAlerts(a.emp_id, "offline_in_zone");
      }

      // ── LOW: battery low (and not charging) ─────────────────────────────────
      const batt = a.battery_level == null ? null : parseInt(a.battery_level, 10);
      if (batt != null && batt <= cfg.lowBatteryPct && !a.battery_charging && !offline) {
        await raiseAlert({
          emp_id: a.emp_id, emp_name: a.emp_name,
          type: "low_battery", severity: "low",
          message: `Battery low (${batt}%). The enforcer stops protecting the device once it powers off — ask the user to charge it.`,
          meta: { battery_level: batt },
        });
      } else {
        await resolveAlerts(a.emp_id, "low_battery");
      }

      let comp = a.compliance_status;
      if (typeof comp === "string") { try { comp = JSON.parse(comp); } catch { comp = {}; } }

      // ── LOW: inside the zone but QR not scanned for too long ────────────────
      // The device is online and reporting from inside the restricted zone but
      // the worker never authenticated at the entrance. Threshold is the
      // admin-set qr_alert_minutes (dashboard settings, default 20 min).
      const qrVerified = comp && comp.qr_verified === true;
      const inZoneSince = parseInt(a.in_zone_since, 10) || 0;
      const qrOverdue = a.in_zone && !offline && !qrVerified &&
        inZoneSince > 0 && now - inZoneSince > cfg.qrAlertMinutes * 60000;
      if (qrOverdue) {
        const mins = Math.round((now - inZoneSince) / 60000);
        await raiseAlert({
          emp_id: a.emp_id, emp_name: a.emp_name,
          type: "qr_not_scanned", severity: "low",
          message: `Device has been inside the restricted zone for ${mins} min without scanning the entrance QR code.`,
          meta: { in_zone_since: inZoneSince, minutes_in_zone: mins, threshold_minutes: cfg.qrAlertMinutes },
        });
      } else {
        await resolveAlerts(a.emp_id, "qr_not_scanned");
      }

      // ── MEDIUM: Network Guard VPN turned off while it should be enforcing ────
      const vpnRevoked = comp && comp.vpn_revoked === true;
      if (a.in_zone && !offline && vpnRevoked) {
        await raiseAlert({
          emp_id: a.emp_id, emp_name: a.emp_name,
          type: "network_tamper", severity: "medium",
          message: "Network Guard (VPN) was disabled on the device while inside the restricted zone.",
        });
      } else {
        await resolveAlerts(a.emp_id, "network_tamper");
      }
    }
  } catch (err) {
    console.warn("[ALERTS] sweep failed:", err.message);
  }
}

// Start the periodic fleet sweep (unref'd so it never keeps the process alive).
function startAlertSweep() {
  setTimeout(sweepFleet, 20 * 1000); // first sweep shortly after boot
  const t = setInterval(sweepFleet, SWEEP_MS);
  if (typeof t.unref === "function") t.unref();
}

module.exports = { raiseAlert, resolveAlerts, sweepFleet, startAlertSweep, OFFLINE_MS, LOW_BATTERY_PCT, QR_ALERT_MINUTES };
