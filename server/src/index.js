require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const initSchema     = require("./db/initSchema");
const { startRetention } = require("./db/retention");
const { startAlertSweep } = require("./db/alerts");
const authRoutes      = require("./routes/auth");
const agentRoutes     = require("./routes/agents");
const settingsRoutes  = require("./routes/settings");

// App usage route — load safely in case file doesn't exist yet
let appUsageRoutes;
try { appUsageRoutes = require("./routes/appUsage"); } catch(e) { console.log("appUsage route not found, skipping"); }

// Per-app time-limit policies — load safely too.
let policiesRoutes;
try { policiesRoutes = require("./routes/policies"); } catch(e) { console.log("policies route not found, skipping"); }

// Device enforcement log stream (real-time dashboard logs) — optional.
let deviceLogsRoutes;
try { deviceLogsRoutes = require("./routes/deviceLogs"); } catch(e) { console.log("deviceLogs route not found, skipping"); }

// Aegis website chatbot (LLM proxy) — optional.
let aegisRoutes;
try { aegisRoutes = require("./routes/aegis"); } catch(e) { console.log("aegis route not found, skipping"); }

// Dashboard user management (admin only) — optional.
let usersRoutes;
try { usersRoutes = require("./routes/users"); } catch(e) { console.log("users route not found, skipping"); }

// Fleet risk alerts (offline-in-zone, low battery, tamper) — optional.
let alertsRoutes;
try { alertsRoutes = require("./routes/alerts"); } catch(e) { console.log("alerts route not found, skipping"); }

const app  = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === "production";

// ─── PRODUCTION SAFETY CHECKS ─────────────────────────────────────────────────
// In production, refuse to run with the insecure default secrets baked in.
if (isProd) {
  const insecure = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("change_in_production")) insecure.push("JWT_SECRET");
  if (!process.env.API_KEY) insecure.push("API_KEY");
  if (insecure.length) {
    console.error(`❌ Refusing to start in production with missing/insecure: ${insecure.join(", ")}`);
    console.error("   Set strong values in the host environment (Render dashboard → Environment).");
    process.exit(1);
  }
}

// Behind a reverse proxy (Render/Heroku/Nginx) so req.ip / protocol are correct.
app.set("trust proxy", 1);

// Simple admin QR display page. Served BEFORE helmet so its default CSP doesn't
// block the inline script + the QR library CDN. The page itself is harmless
// (it asks for the API key client-side and calls /api/qr-current same-origin).
app.get("/qr", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "qr.html"));
});

app.use(helmet());

// CORS origins are configurable via CORS_ORIGINS (comma-separated). Sensible
// defaults cover local dev and any *.onrender.com / *.vercel.app frontend.
const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  ...envOrigins,
  /\.onrender\.com$/,
  /\.vercel\.app$/,
  /\.netlify\.app$/,
];
app.use(cors({
  origin(origin, cb) {
    // Allow non-browser clients (mobile APK, curl) that send no Origin header.
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some((rule) =>
      rule instanceof RegExp ? rule.test(origin) : rule === origin
    );
    return ok ? cb(null, true) : cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(morgan(isProd ? "combined" : "dev"));
app.use(express.json({ limit: "2mb" }));

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api",            agentRoutes);
app.use("/api",            settingsRoutes);
if (appUsageRoutes) app.use("/api/app-usage", appUsageRoutes);
if (policiesRoutes) app.use("/api/policies", policiesRoutes);
if (deviceLogsRoutes) app.use("/api/device-logs", deviceLogsRoutes);
if (aegisRoutes) app.use("/api/aegis", aegisRoutes);
if (usersRoutes) app.use("/api/users", usersRoutes);
if (alertsRoutes) app.use("/api/dashboard/alerts", alertsRoutes);

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Env Guardian Server", version: "1.0.0", timestamp: new Date().toISOString() });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[SERVER ERROR]", err.stack);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// Ensure the schema exists (creates tables + seeds defaults on a fresh DB),
// then start listening. Init failures are logged but don't block startup.
initSchema().finally(() => { startRetention(); startAlertSweep(); app.listen(PORT, () => {
  console.log("");
  console.log("╔═══════════════════════════════════════╗");
  console.log("║     🛡  ENV GUARDIAN SERVER  🛡         ║");
  console.log("╠═══════════════════════════════════════╣");
  console.log(`║  Port     : ${PORT}                       ║`);
  console.log(`║  Env      : ${process.env.NODE_ENV || "development"}              ║`);
  console.log("║  Routes   : /api/auth                 ║");
  console.log("║             /api/agents/*             ║");
  console.log("║             /api/dashboard/*          ║");
  console.log("║             /api/qr-current           ║");
  console.log("║             /api/app-usage            ║");
  console.log("║             /api/policies/*           ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log("");
}); });
