# Env Guardian v2.0 — Backend Server

The Node.js + Express API and PostgreSQL database that act as the central control
point for the whole system: the mobile agents register and heartbeat here, the
admin console drives every operation through this API, and the QR / policy /
whitelist state all live in this database.

- **Runtime:** Node.js ≥ 18, Express 4, `pg` (node-postgres)
- **Database:** PostgreSQL (designed for [Neon](https://neon.tech) serverless)
- **Hosting:** [Render](https://render.com) web service (`render.yaml` included)
- **Auth:** `x-api-key` for devices (the APK), JWT for the admin console

## What this server does

- Stores every registered device ("agent") and its live status (location,
  in-zone, compliance matrix, lock state, installed apps, per-app usage).
- Serves the device API: register, heartbeat, QR verify, agent-status,
  clear-auto-lock, settings, app-usage, policies.
- Serves the admin-console API: auth/login (JWT), fleet listing + metrics,
  remote lock, whitelist + geofence + QR management, user management, and a
  live in-memory device-log stream.
- **Auto-provisions its own schema** on startup — a fresh Neon database is fully
  set up on first boot (idempotent, also migrates older databases forward).
- Prunes non-essential history (`app_usage`, `login_events`) on a daily
  retention job.

## Project layout

```
server/
├── src/
│   ├── index.js              # app bootstrap: helmet, CORS, morgan, routes,
│   │                         #   /health, /qr page, schema init, retention start
│   ├── db/
│   │   ├── pool.js           # pg pool (SSL auto-enabled off-localhost)
│   │   ├── initSchema.js     # idempotent CREATE/ALTER/INDEX + default seeds
│   │   └── retention.js      # daily prune of app_usage + login_events
│   ├── middleware/
│   │   └── auth.js           # requireApiKey / requireJWT / requireAuth / requireRole
│   ├── routes/
│   │   ├── auth.js           # POST /api/auth/login, /verify  (JWT issue)
│   │   ├── agents.js         # register, heartbeat, qr-verify, agent-status,
│   │   │                     #   clear-auto-lock + /api/dashboard/* fleet APIs
│   │   ├── settings.js       # /api/settings, /api/qr-current, geofence/whitelist/QR
│   │   ├── appUsage.js       # /api/app-usage ingest + summaries
│   │   ├── policies.js       # /api/policies per-app time limits + feature flags
│   │   ├── deviceLogs.js     # /api/device-logs live in-memory enforcement stream
│   │   ├── users.js          # /api/users console user management (admin only)
│   │   └── aegis.js          # /api/aegis/chat LLM proxy (dormant — see below)
│   └── utils/
│       └── agentMetrics.js   # compliance-score / metrics helpers
├── public/
│   └── qr.html               # standalone admin QR display page (served pre-helmet)
├── .env.example              # every supported environment variable
├── render.yaml               # Render blueprint
└── package.json
```

## API surface

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /health` | — | Liveness probe |
| `GET /qr` | — (page asks for key client-side) | Admin QR display page |
| `POST /api/auth/login` | — | Admin console login → JWT |
| `POST /api/auth/verify` | — | Validate a JWT |
| `POST /api/register` | api-key | Device registration (bound to first owner; 409 on re-claim) |
| `POST /api/heartbeat` | api-key | Device status/location/compliance push |
| `POST /api/qr-verify` | api-key | Verify a scanned zone QR (static or TOTP) |
| `GET /api/agent-status/:empId` | api-key | Whitelist + policies + lock + feature flags |
| `POST /api/clear-auto-lock` | api-key | Device clears its own auto-lock |
| `GET /api/settings` | api-key **or** JWT | Geofence + global whitelist + QR config |
| `GET /api/qr-current` | api-key **or** JWT | Current zone QR value (rotates in TOTP mode) |
| `PUT /api/settings/*` | JWT (admin/manager) | Geofence, whitelist, QR secret/mode, admin password |
| `POST /api/app-usage` | api-key | Ingest per-app in-zone usage |
| `GET /api/app-usage/:empId`, `/summary/all` | JWT | Usage read-back |
| `GET/PUT/DELETE /api/policies/:empId/*` | JWT | Per-app time limits + feature flags |
| `GET /api/dashboard/agents`, `/:empId`, `/metrics` | JWT | Fleet listing + metrics |
| `POST /api/dashboard/toggle-lock`, `/update-whitelist` | JWT (admin/manager) | Remote lock, per-device whitelist |
| `DELETE /api/dashboard/agents/:empId` | JWT (admin) | Unenroll a device |
| `POST /api/device-logs`, `GET /:empId` | api-key push / JWT read | Live enforcement log stream (in-memory, not persisted) |
| `GET/POST/PUT/DELETE /api/users` | JWT (admin) | Console user management |
| `POST /api/aegis/chat` | — | LLM proxy for the website bot (**dormant**) |

Role gating (`requireRole`) is enforced server-side on every mutation, so the
console UI can't be bypassed from the browser. API-key (device) callers have no
role and keep their existing behaviour.

## Database schema (auto-created)

`initSchema.js` runs on boot and applies each statement on its own connection,
so one failure can't roll back the rest. It creates six tables — `users`,
`agents`, `app_usage`, `app_policies`, `system_settings`, `login_events` — plus
column backfills for older databases and all unique/lookup indexes, then seeds a
default geofence, whitelist, and the three console logins. On success it logs
`✅ Schema ready (42/42 steps applied, defaults seeded)`.

> Device enforcement logs are **intentionally not persisted** — they stream into
> a short in-memory buffer (`routes/deviceLogs.js`) that the console polls back,
> so there is no `device_logs` table by design.

## Configuration

All variables are documented in [`.env.example`](.env.example). The essentials:

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres/Neon connection string (SSL auto-enabled off-localhost) |
| `JWT_SECRET` | ✅ (prod) | Console JWT signing key; prod refuses the insecure default |
| `API_KEY` | ✅ (prod) | Device auth key; prod refuses to start if unset |
| `ADMIN_PASSWORD` | recommended | Seeds the `admin` login + system admin password |
| `QR_SECRET` | optional | Zone QR value (falls back to `API_KEY`) |
| `ENFORCE_DEVICE_TOKEN` | optional | `true` requires `x-device-token` (Feature F) |
| `DATA_RETENTION_DAYS` | optional | History prune window (default `10`) |
| `CORS_ORIGINS` | optional | Extra allowed origins (localhost + `*.onrender/vercel/netlify.app` are built in) |
| `LLM_API_KEY`, `LLM_MODEL` | optional | Aegis LLM proxy (dormant; the website no longer uses it) |
| `SKIP_DB_INIT` | optional | `true` skips schema bootstrap |

In production the server **refuses to start** with a missing `API_KEY` or an
insecure default `JWT_SECRET`.

## Run locally

```bash
cd server
cp .env.example .env      # fill in DATABASE_URL etc.
npm install
npm run dev               # nodemon; or: npm start
```

Then hit `http://localhost:3001/health`. Tables are created automatically on
first boot.

## Deploy (Render)

Root Directory = `server`, build `npm ci`, start `npm start`, `NODE_ENV=production`,
and set the env vars above. The included `render.yaml` captures this blueprint.
See the root [README](../README.md) and [`dashboard/DEPLOYMENT.md`](../dashboard/DEPLOYMENT.md)
for the full deploy walkthrough.

## The Aegis LLM proxy (`routes/aegis.js`) — dormant

`POST /api/aegis/chat` proxies to Anthropic (Claude) with a **server-side** key so
no secret reaches the browser: per-IP rate limiting (25 req/60s), message
sanitising, a 20 s timeout, and a system prompt that refuses to reveal
secrets/source/bypasses. It defaults to `claude-haiku-4-5-20251001` (override with
`LLM_MODEL`). The website's chat widget has been **removed**, so this route is
kept only for future use — if `LLM_API_KEY` is unset it returns
`success:false` and nothing depends on it.
