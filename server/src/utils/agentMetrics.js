// Shared helpers for deriving dashboard-facing metrics from a raw `agents` row.
// The live DB stores raw signals (last_pulse, compliance_status JSONB, in_zone)
// while the dashboard UI expects derived fields (is_online, compliance_score, zone).
// Centralising the derivation here keeps every route consistent.

const ONLINE_WINDOW_MS = 120000; // device considered online if pulsed within 2 min

// Compliance score is based on the 7 core device checks.
// qr_verified is a zone-authentication signal, NOT a compliance factor, so it
// is intentionally excluded from the percentage.
const COMPLIANCE_CHECKS = ["notif", "loc", "gps", "batt", "overlay", "cam", "access"];

function parseCompliance(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

// Adds is_online, compliance_score, zone, zone_status, policy_status, last_seen
// to a raw agent row without dropping any existing column.
function enrichAgent(a) {
  if (!a) return a;
  const lastPulse = parseInt(a.last_pulse, 10) || 0;
  const isOnline = lastPulse > 0 && (Date.now() - lastPulse) < ONLINE_WINDOW_MS;

  const comp = parseCompliance(a.compliance_status);
  const passed = COMPLIANCE_CHECKS.filter((k) => comp[k]).length;
  const score = Math.round((passed / COMPLIANCE_CHECKS.length) * 100);

  const zone = a.in_zone ? "RESTRICTED" : "SAFE";

  return {
    ...a,
    is_online: isOnline,
    compliance_score: score,
    zone,
    zone_status: zone,
    policy_status: score >= 80 ? "PASS" : "FAIL",
    last_seen: lastPulse || null,
  };
}

module.exports = { enrichAgent, ONLINE_WINDOW_MS, COMPLIANCE_CHECKS };
