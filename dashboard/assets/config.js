// ── Env Guardian Admin Console configuration ─────────────────────────────────
// Set API_BASE to your deployed backend (the /server folder on Render).
// It can also be overridden at runtime from the login screen ("Server
// connection") — that value is stored in the browser and wins over this file.
window.EG_CONFIG = {
  API_BASE: "https://envguardian-server-j8yv.onrender.com", // ← change to your Render URL

  // How often (ms) live pages re-poll the server.
  REFRESH_MS: 20000,

  // Compliance score at/above which a device counts as compliant (matches
  // the server's policy_status PASS threshold).
  COMPLIANT_AT: 80,
};
