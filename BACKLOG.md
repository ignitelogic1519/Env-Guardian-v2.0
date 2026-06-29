# Env Guardian v2.0 — Feature Backlog

Running list of features **discussed but NOT yet built**, so nothing gets lost
between sessions. (Things already shipped are in git history / the READMEs.)

> Guiding constraint: **BYOD only.** No Device Owner, no factory reset / device
> wipe. Everything must work on a user's personal device with only granted
> permissions. Enforcement is therefore **deterrent-grade + tamper-detected**,
> not tamper-proof.

## ✅ Already shipped (for reference)

### Foundation / infra
- Monorepo set up (`app/` + `server/`), server hosted on Render, database on Neon
- App connected to the server (URL + API key), HTTPS enforced (cleartext disabled)
- Modular, feature-first app code structure (`core/` + `features/`)
- Backend: idempotent auto-migrating schema; API-key + JWT auth; routes for
  register / heartbeat / qr-verify / agent-status / settings / app-usage / policies

### Features
- Android version + SDK level reported to the database
- Zone timer (in-app live clock + notification) for time-in-zone
- Per-app daily time limits (server `app_policies` + `feature_flags` key + native
  UsageStats enforcement + usage reported to server)
- Map page shows the restricted zone (red boundary + corner points + INSIDE/OUTSIDE
  badge, auto-fits to show zone + device)
- Per-app usage measurement via native UsageStatsManager (+ Usage Access affordance)
- Security: device **bound to first owner**; re-registration under a different
  identity blocked (anti-theft, HTTP 409)
- Zone QR code generation (image produced from the `qr_secret`)

### Bug fixes
- Fixed settings sync (missing API-key header) so the geofence / global whitelist /
  admin password / QR secret actually load on the device

### UI
- **Neumorphism + glassmorphism** look: animated aurora gradient background,
  frosted-glass panels, modern fonts (Inter + Outfit), entrance/transition animations

### Docs
- `README.md` (detailed feature reference), `ADMIN_DB_GUIDE.md` (DB-driven admin
  SQL cookbook), `TEST_CASES.md` (QA plan + server smoke tests), this `BACKLOG.md`

## 🔜 Planned / not yet built

> Status of the original A–I list: **none of A, B, C, E, F, G, H, I have been built
> yet.** D was reworked (admin is DB-driven now; web dashboard deferred).

### A. Pre-scan "clean state" gate  *(on hold — pending decisions)*
Before the QR scan (in-zone), block the scanner if non-whitelisted apps are
running; show the list + prompt to close them; whitelisted apps are exempt.
- Detection: accessibility recent-foreground history + Usage Access (recent apps)
- Optional: **Notification Access** to catch background-media apps (e.g. YouTube
  Premium music) via their foreground-service/media notification
- Android reality: can't list/kill true background apps → soft gate + blocker enforces

### B. VPN-based per-app network control  *(planned)*
Local `VpnService` (no root) that, on **zone entry**, auto-enables and **blocks
non-whitelisted apps' internet** (e.g. YouTube), then disables on exit.
- One-time VPN consent at setup; auto start/stop after that
- Tamper detection (`onRevoke`) → feed into compliance / auto-lock / admin alert
- Optional onboarding step: user enables "Always-on VPN + block w/o VPN"
- Caveats: one VPN at a time; user can disable on BYOD (detectable); status-bar icon

### C. Auto-start / auto-foreground on zone entry  *(planned — newest request)*
When the user enters the zone, automatically bring the app's compliance/QR
screen to the foreground (and ensure the service is running even if killed).
- Foreground UI launch: overlay permission / full-screen-intent notification /
  accessibility (mechanisms we already have)
- Wake-if-killed: Android **Geofencing API** (OS triggers app on geofence enter/exit)
- Caveats: OEM battery killers can delay/kill; mitigate w/ battery-opt exemption + boot receiver

### D. Admin configuration — DB-driven for now  *(web dashboard deferred)*
Decision: **no web dashboard yet.** All admin config is done directly in the
database (Neon SQL) — see **`ADMIN_DB_GUIDE.md`** for copy-paste commands:
geofence, global + per-device whitelist, per-app time limits, feature keys,
lock/unlock, QR/password, delete device. No code change needed — the server +
app already read and sync these values.
- Future (optional): a web dashboard that simply wraps these same DB operations
  in a UI, and displays the zone QR (server already has `/api/qr-current`).

### E. OEM background-reliability hardening  *(planned)*
Per-OEM onboarding deep-links to keep the service alive on aggressive skins:
- Autostart + battery whitelist for Xiaomi/MIUI, Oppo/Realme/ColorOS, Vivo, Samsung
- Watchdog / restart strategy

### F. Security hardening  *(planned)*
- Replace the hardcoded in-APK API key with **per-device tokens** issued at registration
- Move secrets out of source (build-time config)

### G. Dynamic / rotating QR  *(planned)*
Replace the static QR string with a time-based (TOTP) or server-signed value so a
photographed QR can't be reused.

### H. Production readiness  *(planned)*
- Change application ID off `com.example.env_guardian`
- Distribution plan (direct APK / private channel, since accessibility+VPN are Play-policy sensitive)

### I. Polish / optional
- Notification timer that ticks every second via native chronometer
- **Samsung Knox** enhanced enforcement mode (stronger control on Samsung, no reset)
- Network/Wi-Fi-level enforcement (org firewall/NAC) as a device-agnostic complement
- End-to-end verification of per-app time limits (built, not yet tested on a device)
