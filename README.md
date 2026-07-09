# Env Guardian v2.0

A **Mobile Device Management (MDM) / Zero-Trust** solution for **Bring Your Own
Device (BYOD)** environments.

When an employee's personal phone physically enters a defined **restricted zone**
(a geofence), Env Guardian enforces a security policy: only **approved apps** may
be used, the user must pass a **physical QR authentication**, optional **per-app
time limits** apply, and the device's compliance + activity are reported to a
central server in real time. The moment the device leaves the zone, normal use
resumes.

> **Design constraint: BYOD-first.** No Device Owner, no factory reset. Everything
> runs on a personal device using only user-granted permissions. Enforcement is
> therefore **deterrent-grade and tamper-detected**, not tamper-proof.

---

## Repository layout (monorepo)

```
env-guardian-v2.0/
├── app/                # Flutter mobile app (the device agent)
├── server/             # Node.js + Express API + PostgreSQL schema
├── dashboard/          # Web admin console (static SPA, role-based) — host separately
├── website/            # Marketing website (static)
├── README.md           # this file
├── BACKLOG.md          # planned / not-yet-built features
└── ADMIN_DB_GUIDE.md   # how to administer the system via the database (SQL)
```

| Part | Tech | Hosted on |
|------|------|-----------|
| `app/`    | Flutter (Dart) + native Kotlin | Built as an APK (direct distribution) |
| `server/` | Node.js, Express, `pg` | [Render](https://render.com) (free) |
| database  | PostgreSQL | [Neon](https://neon.tech) (free, serverless) |

---

## ✅ Implemented features (detailed)

### 1. Device registration & "sealing"
- First launch collects **employee name + ID**, reads **device id, model, Android
  version, SDK level**, and registers with the server (`POST /api/register`).
- On success the device is **sealed** and the background monitor starts.

### 2. Security — device bound to its first owner
- A `device_id` is **permanently bound** to the identity that first registers it.
- Re-registration is allowed **only for the same identity** (e.g. an app reinstall);
  a **different** name/ID on that device is **rejected (HTTP 409)**.
- Protects against a **lost/stolen device** being re-claimed by someone else.
- To re-assign a device, an admin must delete it first (see `ADMIN_DB_GUIDE.md`).

### 3. Always-on background monitoring ("the Ghost")
- A foreground service runs a **10-second loop** independent of the UI: refreshes
  location, compliance, server sync, lock state, and the persistent notification.
- Auto-starts on boot; survives the app being closed.
- **OEM keep-alive helper:** a compliance tile opens the manufacturer's Auto-start
  screen (MIUI/ColorOS/Funtouch/OneUI/EMUI/OnePlus) so aggressive skins don't kill
  the monitor (battery-optimization exemption is requested in the Battery step).

### 4. Geofencing / restricted-zone detection
- The zone is a **polygon** stored server-side; the app does point-in-polygon
  checks against live GPS to decide **in-zone vs safe-zone**.

### 5. Map page
- Draws the **restricted zone** (red boundary + translucent fill + **red corner
  points**), the **device location**, an **INSIDE/OUTSIDE ZONE** badge, and a
  legend. The camera **auto-fits to show both the zone and the device**.

### 6. QR authentication + zone timer
- Inside the zone, the user scans a **physical QR code** whose value must match
  the server's `qr_secret`. On success the device becomes **verified**.
- A **time-in-zone clock** starts on verification — shown **live on screen** and in
  the **ongoing notification** — and resets when the device leaves the zone.

### 7. App blocking (Zero-Trust enforcer)
- A native **AccessibilityService** detects the foreground app; inside the zone,
  any **non-whitelisted** app is immediately sent back to the home screen.
- Includes an **anti-tamper shield** (blocks attempts to force-stop the app via
  Settings) and a **liveness heartbeat** so the server knows the enforcer is alive.

### 8. Whitelist management (two-way sync)
- **Global whitelist** (`system_settings.whitelisted_apps`) — admin-controlled,
  applies to all devices.
- **Per-device whitelist** (`agents.custom_whitelist`) — also editable in-app via
  the admin-locked **Armory** vault.
- The device enforces the **union** of both.

### 9. Per-app daily time limits
- Admins define, per user, **which apps** may be used and **for how long per day**
  (`app_policies` table), unlocked by a per-user **feature key**
  (`agents.feature_flags`).
- The app measures real usage via the native **UsageStatsManager** and blocks an
  app once it's **disabled** or **over budget**; usage is reported back to the server.
- Enforcement is computed **natively** (in `AppBlockerService`, every ~5s) from a
  base whitelist Dart publishes + live usage, so time limits apply **even when the
  app is closed** — not just while the Command Center is open.
- When **Network Guard** (feature B) is on, an over-budget app also **loses
  internet** — the effective (time-limit-adjusted) whitelist feeds both the
  accessibility blocker and the VPN bypass list.

### 10. Compliance & locking
- Tracks notification/location/GPS/battery/overlay/camera/accessibility/usage
  permissions → a **compliance score**.
- **Auto-lock** on a time/heartbeat anomaly inside the zone; **admin lock**
  ("banishment") pushed from the server. Unlock requires the admin password.

### 11. Telemetry reported to the server
- Heartbeat sends location, in-zone state, compliance matrix, installed apps,
  **Android version/SDK**, lock state, and per-app usage.

### 12. UI — neumorphism + glassmorphism
- Animated **aurora gradient** background, **frosted-glass** panels, **neumorphic**
  soft elements, modern type (**Inter + Outfit** via google_fonts), and subtle
  **entrance/transition animations**.

### 13. Backend (server)
- Express REST API: `register`, `heartbeat`, `qr-verify`, `agent-status`,
  `settings`, `app-usage`, `policies`, `dashboard/*`, `auth`.
- **API-key** auth for devices, **JWT** for the (future) dashboard.
- **Idempotent schema bootstrap** — creates/upgrades all tables on startup, so a
  fresh Neon database is provisioned automatically.

### 14. Web admin console (role-based)
- **[`dashboard/`](dashboard/README.md)** — an online admin console (static SPA,
  hosted separately for free) covering devices, per-device admin, policy
  controller, QR settings (static/TOTP), enrollment/unenrollment, users & roles
  and a metrics page (logins, compliant vs non-compliant, top apps).
- Access groups come from the database (`users.role`: `admin` / `manager` /
  `viewer`) and are enforced server-side (`requireRole`).
- Deploy guide: **[`dashboard/DEPLOYMENT.md`](dashboard/DEPLOYMENT.md)**.
- The SQL cookbook in **[`ADMIN_DB_GUIDE.md`](ADMIN_DB_GUIDE.md)** still works as
  a fallback for direct database administration.

---

## Feature rollout status (A–I)

Tracked in **[`BACKLOG.md`](BACKLOG.md)**. All require a **device build + QA pass**
(see [`QA_CHECKLIST.md`](QA_CHECKLIST.md)); the heavier native ones (A, B) are
marked experimental until verified on real hardware.

| ID | Feature | Status |
|----|---------|--------|
| A | Pre-scan clean-state gate (close running apps before QR) | ✅ Shipped (Notification Access — **now mandatory** for compliance) |
| B | VPN per-app network control (block internet in-zone) | ✅ Shipped — **always-on**: one-time consent at setup, auto-activates in-zone, no in-app disable, background-managed, time-limit-aware, tamper-reported (**experimental, test on device**) |
| C | Auto-foreground on zone entry | ✅ Shipped (full-screen prompt; geofence-wake = future) |
| D | Admin dashboard (web) | ✅ Shipped — role-based console in [`dashboard/`](dashboard/README.md) (deploy guide: [`dashboard/DEPLOYMENT.md`](dashboard/DEPLOYMENT.md)); SQL guide remains as fallback |
| E | OEM background reliability | ✅ Auto-start helper shipped — **now a mandatory acknowledgement**; opens via a grace window so the enforcer doesn't bounce you out (watchdog = future) |
| F | Per-device auth tokens | ✅ Shipped — issued now; enforce via `ENFORCE_DEVICE_TOKEN=true` |
| G | Rotating (TOTP) QR | ✅ Shipped, opt-in (`qr_mode='totp'`; needs a live display) |
| H | Production app id | ✅ `com.envguardian.mdm` (distribution = direct/private APK) |
| I | Polish | ⬜ Chronometer notif, Samsung Knox, Wi-Fi enforcement (future) |

> **New permissions introduced by this rollout**: **Notification Access**
> (feature A), **VPN consent** (feature B), plus the existing **Usage Access** and
> **Auto-start** helper (E).
>
> - **Network Guard (VPN)** is now granted **once during first-run setup** (a
>   required step) and is **always-on**: it auto-activates on every zone entry with
>   no further prompt, and has **no in-app off switch**. If the user disables it in
>   system settings it re-establishes automatically in-zone and the tamper
>   (`vpn_revoked`) is reported. *(BYOD limit: Android always permits disabling a
>   VPN in system settings; enforcement is deterrent-grade, not an OS-level lock.)*
> - **Usage Access, Notification Access and OEM Auto-start are now MANDATORY** for
>   compliance (previously optional). They are required setup steps and also appear
>   on the "Compliance Required" screen until satisfied. Auto-start has no
>   queryable state on Android, so it is satisfied by a one-time **acknowledgement**
>   (the user visits the OEM screen); the others are read back directly.
> - **Settings grace window:** tapping a compliance tile that opens a system
>   settings page arms a ~45s window during which the accessibility enforcer stands
>   down — so its anti-tamper shield no longer bounces the user out of the very
>   settings screen (e.g. OEM auto-start / app details) they were sent to.

---

## Getting started

### Server (Render + Neon)
1. Create a PostgreSQL database on **Neon**, copy its connection string.
2. Deploy `server/` to **Render** (Root Directory = `server`, build `npm ci`,
   start `npm start`).
3. Set env vars: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `API_KEY`,
   `ADMIN_PASSWORD`, `QR_SECRET`. Tables are auto-created on first boot.

### App (Flutter)
```bash
cd app
flutter pub get
flutter run          # or: flutter build apk
```
Point the app at your server URL + API key in `app/lib/cloud_sync.dart`.

### Administer the system
See **[`ADMIN_DB_GUIDE.md`](ADMIN_DB_GUIDE.md)** for the SQL to set the zone,
whitelist apps, configure time limits, and lock/unlock devices.

---

## Documentation index
- **[`app/README.md`](app/README.md)** — app structure (feature-first layout)
- **[`server/README.md`](server/README.md)** — backend overview
- **[`dashboard/README.md`](dashboard/README.md)** — admin console features + RBAC matrix
- **[`dashboard/DEPLOYMENT.md`](dashboard/DEPLOYMENT.md)** — free-hosting deploy guide
- **[`ADMIN_DB_GUIDE.md`](ADMIN_DB_GUIDE.md)** — administer via the database
- **[`TEST_CASES.md`](TEST_CASES.md)** — granular QA cases + server smoke tests
- **[`QA_CHECKLIST.md`](QA_CHECKLIST.md)** — end-to-end user-story integrity checklist
- **[`BACKLOG.md`](BACKLOG.md)** — feature rollout status + future work
