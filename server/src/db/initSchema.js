// Idempotent schema bootstrap + lightweight migration.
//
// Runs on server startup so the database has every table, column, index and
// seed row the app needs — whether it's a brand-new Neon project OR an older
// database that predates some columns (schema drift).
//
// Design notes:
//   - Each statement runs on its OWN connection/transaction. A failure in one
//     (e.g. an index on a not-yet-added column) can NOT roll back the others.
//     (A multi-statement string in one query() runs as a single transaction,
//      so one late failure would undo everything — we avoid that here.)
//   - CREATE TABLE IF NOT EXISTS creates missing tables.
//   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS backfills columns on tables that
//     already exist but are missing them (the key fix for older Neon DBs).
//   - Seeds use ON CONFLICT DO NOTHING, so existing data is never overwritten.
//
// Set SKIP_DB_INIT=true to disable.

const pool = require("./pool");

// Run statements one-by-one; never let one failure abort the rest.
const STATEMENTS = [
  // ── Tables (created only if missing) ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS public.users (
     id              SERIAL PRIMARY KEY,
     org_name        varchar(100) NOT NULL DEFAULT 'Env Guardian',
     username        varchar(50)  NOT NULL UNIQUE,
     password        varchar(255) NOT NULL,
     role            varchar(20)  NOT NULL DEFAULT 'admin',
     full_name       varchar(100),
     is_active       boolean      NOT NULL DEFAULT true,
     created_at      bigint       NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint,
     last_login      bigint,
     email           varchar(150),
     phone           text,
     department      text,
     employee_id     text,
     avatar_initials text
   )`,
  // NOTE: the `employees` table is intentionally NOT managed here — employee
  // management moves to the separate HRMS. agents.employee_id is left as a
  // plain (unused) column for a future HRMS linkage.
  `CREATE TABLE IF NOT EXISTS public.agents (
     id                SERIAL PRIMARY KEY,
     emp_name          varchar(100) NOT NULL,
     emp_id            varchar(50)  NOT NULL,
     device_id         varchar(255) NOT NULL,
     device_model      varchar(100),
     android_version   varchar(20),
     sdk_int           integer,
     registered_at     bigint,
     current_lat       double precision,
     current_lng       double precision,
     in_zone           boolean DEFAULT false,
     enforcer_active   boolean DEFAULT false,
     last_pulse        bigint,
     installed_apps    jsonb,
     admin_lock        boolean DEFAULT false,
     compliance_status jsonb DEFAULT '{"cam": true, "loc": true, "batt": true, "notif": true, "access": true, "overlay": true}'::jsonb,
     auto_lock         boolean DEFAULT false,
     custom_whitelist  jsonb DEFAULT '[]'::jsonb,
     user_id           integer,
     employee_id       integer
   )`,
  `CREATE TABLE IF NOT EXISTS public.app_usage (
     id          SERIAL PRIMARY KEY,
     emp_id      varchar(50)  NOT NULL,
     date        date         NOT NULL,
     package     varchar(200) NOT NULL,
     total_ms    bigint NOT NULL DEFAULT 0,
     last_used   bigint NOT NULL DEFAULT 0,
     recorded_at bigint NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint
   )`,
  // Per-user, per-app time budgets set by the admin.
  // daily_limit_ms = how long this app may be used per day (in ms); 0 = unlimited.
  // enabled = whether this app is allowed at all inside the zone.
  `CREATE TABLE IF NOT EXISTS public.app_policies (
     id             SERIAL PRIMARY KEY,
     emp_id         varchar(50)  NOT NULL,
     package        varchar(200) NOT NULL,
     daily_limit_ms bigint  NOT NULL DEFAULT 0,
     enabled        boolean NOT NULL DEFAULT true,
     updated_at     bigint  NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint
   )`,
  `CREATE TABLE IF NOT EXISTS public.system_settings (
     id               SERIAL PRIMARY KEY,
     admin_password   varchar(100) NOT NULL,
     geofence_polygon jsonb NOT NULL,
     qr_secret        varchar(255) NOT NULL,
     qr_mode          varchar(10) DEFAULT 'static',
     updated_at       bigint,
     whitelisted_apps jsonb DEFAULT '[]'::jsonb
   )`,
  // Dashboard login audit — powers the "number of logins" metric.
  `CREATE TABLE IF NOT EXISTS public.login_events (
     id        SERIAL PRIMARY KEY,
     user_id   integer,
     username  varchar(50),
     role      varchar(20),
     ts        bigint NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint
   )`,
  // Fleet risk alerts surfaced on the dashboard. Raised by the server when a
  // device trips a risk condition (offline while inside the restricted zone,
  // internet cut off in-zone, low battery, VPN/enforcer tamper…). Deduplicated
  // while an alert of the same (emp_id, type) is still unresolved.
  `CREATE TABLE IF NOT EXISTS public.alerts (
     id          SERIAL PRIMARY KEY,
     emp_id      varchar(50),
     emp_name    varchar(100),
     type        varchar(40)  NOT NULL,
     severity    varchar(12)  NOT NULL DEFAULT 'medium',
     message     text,
     meta        jsonb,
     resolved    boolean NOT NULL DEFAULT false,
     created_at  bigint  NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint,
     updated_at  bigint  NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint,
     resolved_at bigint
   )`,
  // Device enforcement logs stream live into an in-memory ring buffer (see
  // routes/deviceLogs.js). They are ALSO persisted here — but only temporarily —
  // when an admin flips on live-log capture for a device from the dashboard
  // (agents.log_capture). Retention prunes anything older than 1 day so the table
  // stays small; it is a short-lived on-demand capture, not a permanent log store.
  `CREATE TABLE IF NOT EXISTS public.device_logs (
     id          SERIAL PRIMARY KEY,
     emp_id      varchar(50)  NOT NULL,
     package     varchar(300),
     blocked     boolean,
     kind        varchar(12),
     ts          bigint NOT NULL,
     created_at  bigint NOT NULL DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint
   )`,

  // ── Column backfills for older databases (schema drift) ───────────────────
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS user_id integer`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS employee_id integer`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS auto_lock boolean DEFAULT false`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS custom_whitelist jsonb DEFAULT '[]'::jsonb`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS compliance_status jsonb DEFAULT '{}'::jsonb`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS installed_apps jsonb`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS enforcer_active boolean DEFAULT false`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS in_zone boolean DEFAULT false`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS last_pulse bigint`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS registered_at bigint`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS device_model varchar(100)`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS android_version varchar(20)`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS sdk_int integer`,
  // Per-user "special key": a JSON object of feature toggles the admin controls,
  // e.g. {"app_time_limits": true}. Lets an admin unlock special behaviour per user.
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS feature_flags jsonb DEFAULT '{}'::jsonb`,
  // Per-device auth token (feature F) + QR rotation mode (feature G).
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS device_token text`,
  // Battery telemetry (reported on every heartbeat) — powers the dashboard
  // battery pill + the low-battery alert.
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS battery_level integer`,
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS battery_charging boolean`,
  // On-demand live-log capture flag. When true, the device's pushed enforcement
  // logs are ALSO persisted to public.device_logs so the dashboard can show a
  // history (retained ≤ 1 day). Toggled per device from the dashboard.
  `ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS log_capture boolean DEFAULT false`,
  `ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS qr_mode varchar(10) DEFAULT 'static'`,
  // users table backfills (in case an older/partial users table exists)
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS org_name varchar(100) DEFAULT 'Env Guardian'`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'admin'`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS full_name varchar(100)`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at bigint DEFAULT (EXTRACT(epoch FROM now()) * 1000)::bigint`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login bigint`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email varchar(150)`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS department text`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS employee_id text`,
  `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_initials text`,

  // ── Unique constraints / indexes (each guarded individually) ──────────────
  // emp_id / device_id uniqueness powers the APK upserts (ON CONFLICT).
  `CREATE UNIQUE INDEX IF NOT EXISTS agents_emp_id_key   ON public.agents (emp_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agents_device_id_key ON public.agents (device_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_usage_emp_id_date_package_key ON public.app_usage (emp_id, date, package)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_user_id     ON public.agents (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_app_usage_date      ON public.app_usage (date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_usage_emp_date  ON public.app_usage (emp_id, date DESC)`,
  // One policy row per (employee, app). Powers upserts from the dashboard.
  `CREATE UNIQUE INDEX IF NOT EXISTS app_policies_emp_pkg_key ON public.app_policies (emp_id, package)`,
  `CREATE INDEX IF NOT EXISTS idx_app_policies_emp ON public.app_policies (emp_id)`,
  `CREATE INDEX IF NOT EXISTS idx_login_events_ts ON public.login_events (ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_open ON public.alerts (resolved, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_emp_type ON public.alerts (emp_id, type, resolved)`,
  `CREATE INDEX IF NOT EXISTS idx_device_logs_emp_ts ON public.device_logs (emp_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_device_logs_created ON public.device_logs (created_at)`,
];

// Default restricted zone (Zone 1 — Surat, Gujarat).
const DEFAULT_GEOFENCE = [
  { lat: 21.183031, lng: 72.785091 },
  { lat: 21.18336,  lng: 72.787155 },
  { lat: 21.185533, lng: 72.786946 },
  { lat: 21.185101, lng: 72.78432 },
];

const DEFAULT_WHITELIST = [
  "com.google.android.permissioncontroller",
  "com.android.permissioncontroller",
  "com.blogspot.newapphorizons.fakegps",
];

async function runStatement(sql) {
  try {
    await pool.query(sql);
    return true;
  } catch (err) {
    console.error(`⚠️  init step failed: ${err.message}\n    SQL: ${sql.split("\n")[0].trim()}…`);
    return false;
  }
}

async function seed() {
  const adminPassword = process.env.ADMIN_PASSWORD || "FoldedSteel2026";
  const qrSecret = process.env.QR_SECRET || process.env.API_KEY || "FoldedSteelSecret2026";

  // One settings row (id = 1) — the rest of the code reads WHERE id = 1.
  await runStatementParams(
    `INSERT INTO public.system_settings (id, admin_password, geofence_polygon, qr_secret, updated_at, whitelisted_apps)
     VALUES (1, $1, $2::jsonb, $3, $4, $5::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [adminPassword, JSON.stringify(DEFAULT_GEOFENCE), qrSecret, Date.now(), JSON.stringify(DEFAULT_WHITELIST)]
  );

  // Default dashboard logins (only inserted if the username doesn't exist).
  const users = [
    { org: "Env Guardian", username: "admin",    password: adminPassword,  role: "admin",   name: "System Administrator", emp: "EMP-001", initials: "SA" },
    { org: "Env Guardian", username: "manager1", password: "Manager@2026", role: "manager", name: "Manager One",          emp: "EMP-002", initials: "M1" },
    { org: "Env Guardian", username: "viewer1",  password: "Viewer@2026",  role: "viewer",  name: "Viewer One",           emp: "EMP-003", initials: "V1" },
  ];
  for (const u of users) {
    await runStatementParams(
      `INSERT INTO public.users (org_name, username, password, role, full_name, is_active, employee_id, avatar_initials)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7)
       ON CONFLICT (username) DO NOTHING`,
      [u.org, u.username, u.password, u.role, u.name, u.emp, u.initials]
    );
  }
}

async function runStatementParams(sql, params) {
  try {
    await pool.query(sql, params);
  } catch (err) {
    console.error(`⚠️  seed step failed: ${err.message}`);
  }
}

async function initSchema() {
  if (String(process.env.SKIP_DB_INIT).toLowerCase() === "true") {
    console.log("⏭  SKIP_DB_INIT=true — skipping schema bootstrap");
    return;
  }
  let ok = 0;
  for (const sql of STATEMENTS) {
    if (await runStatement(sql)) ok++;
  }
  await seed();
  console.log(`✅ Schema ready (${ok}/${STATEMENTS.length} steps applied, defaults seeded)`);
}

module.exports = initSchema;
