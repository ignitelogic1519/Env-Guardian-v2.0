const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL is not set. Refusing to start without a database.");
  process.exit(1);
}

// Decide whether SSL is required.
// - Local Postgres (localhost / 127.0.0.1) → no SSL.
// - Any managed/cloud Postgres (Neon, Render, RDS, etc.) → SSL required.
// - Can be forced either way with PGSSL=true|false.
function shouldUseSSL(url) {
  if (process.env.PGSSL === "true") return true;
  if (process.env.PGSSL === "false") return false;
  if (/sslmode=require/i.test(url)) return true;
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (isLocal) return false;
  // Production / any remote host → assume SSL.
  return process.env.NODE_ENV === "production" || !isLocal;
}

const useSSL = shouldUseSSL(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err.message);
});

// Test connection on startup
pool.query("SELECT NOW()").then(() => {
  console.log(`✅ Database connected successfully (SSL: ${useSSL ? "on" : "off"})`);
}).catch((err) => {
  console.error("❌ Database connection failed:", err.message);
  console.error("   Check your DATABASE_URL in the environment.");
});

module.exports = pool;
