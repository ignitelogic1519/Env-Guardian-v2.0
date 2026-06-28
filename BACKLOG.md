# Env Guardian v2.0 — Feature Backlog

Running list of features **discussed but NOT yet built**, so nothing gets lost
between sessions. (Things already shipped are in git history / the READMEs.)

> Guiding constraint: **BYOD only.** No Device Owner, no factory reset / device
> wipe. Everything must work on a user's personal device with only granted
> permissions. Enforcement is therefore **deterrent-grade + tamper-detected**,
> not tamper-proof.

## ✅ Already shipped (for reference)
- Android version + SDK level reported to the database
- Zone timer (in-app live clock + notification) for time-in-zone
- Per-app daily time limits (server policy + `feature_flags` key + native UsageStats enforcement)
- Neumorphic UI theme + Usage Access affordance
- Modular, feature-first code structure (`core/` + `features/`)
- Map page shows the restricted zone (red boundary + corner points + inside/outside badge, auto-fit)
- Fixed settings sync (API key) so the geofence actually loads
- Security: device bound to first owner; re-registration under a different identity blocked
- Zone QR code generation

## 🔜 Planned / not yet built

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

### D. Admin dashboard (web)  *(planned)*
Point-and-click admin console instead of raw SQL:
- Set/draw geofence, manage whitelist, set per-app time limits, toggle feature keys
- View agents (live status, android version, usage), lock/unlock, delete device
- Display the current zone QR (server already has `/api/qr-current`)

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
