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

> **Rollout in progress** (one verified commit at a time, safest-first; the
> codebase can't be compiled in the build sandbox, so each item must be built +
> tested on a device after it lands). Current status:
> - **E** — started ✅ (OEM Auto-start helper shipped; watchdog still to do)
> - **D** — reworked → DB-driven admin (web dashboard deferred)
> - **A, B, C, F, G, H, I** — specced below, not yet built
> Order planned: **E → C → G → A → B → F → H**, with I/polish folded in.

### A. Pre-scan "clean state" gate  *(shipped — Notification Access now MANDATORY)*
- ✅ **Notification Access is now a required compliance item** (setup step 8 + a
  Compliance-screen tile), not optional. The device is not "compliant" without it.
- ✅ Native `GuardianNotifListener` (NotificationListenerService) tracks apps with
  active notifications = "running in background" (catches background-media like
  YouTube Premium). MainActivity exposes hasNotificationAccess /
  openNotificationAccessSettings / getActiveNotificationPackages.
- ✅ App: a **"Notification Access"** compliance tile to grant it; before the QR
  scanner, if any **non-whitelisted, non-system** app is running, the scanner is
  replaced by a **"Close these apps"** screen (list + Re-check) until clear.
- Behaviour: whitelisted + system apps are exempt; if access isn't granted the
  gate fails open (scanner shown) — grant it to enforce.
- Limit (Android reality): can't list/kill truly silent background apps; covers
  apps that post a notification (i.e. ones actually doing work) + the blocker
  still kicks anything that surfaces.

### B. VPN-based per-app network control  *(shipped — experimental)*
- ✅ Native `GuardianVpnService` (no root): a black-hole VPN that routes all
  traffic and drops it, while **whitelisted apps + self bypass** (keep internet)
  → non-whitelisted apps lose internet while active.
- ✅ MainActivity: prepareVpn (one-time consent) / startVpn(whitelist) / stopVpn /
  isVpnRunning; manifest registers the VpnService.
- ✅ **Always-on by policy:** the one-time VPN consent is captured during
  **first-run setup** (step 6, **required to seal** the device), and the guard is
  marked permanently enabled. It then **auto-activates on every zone entry with no
  further prompt**. There is **no in-app "off"** switch — the Security Features
  panel only shows status and offers **re-grant** if consent was lost. (Earlier
  interim design put an on/off toggle in that panel; superseded by always-on.)
- ⚠️ **BYOD honesty:** Android always lets the user disable a VPN from system
  settings; we cannot hard-lock it without Device Owner (out of scope). Enforcement
  is **deterrent-grade**: the native reconciler re-establishes it automatically
  while in-zone and `vpn_revoked` is reported — not an OS-level block.
- ✅ **Native lifecycle (reliable stop-on-exit)**: the VPN is reconciled **entirely
  on the native side** — a ~5s loop in `AppBlockerService` (the always-alive
  accessibility service, running in the main app process) reads `in_restricted_zone`
  + `vpn_enabled` + the native whitelist and starts the tunnel on zone entry,
  re-establishes it when the whitelist changes, and **stops it the moment the device
  leaves the zone — even when the Flutter UI is closed.** This replaced the earlier
  Dart `reconcileVpn`, which could not stop the tunnel from the background isolate
  (the VPN method channel isn't reachable there) — the bug where the VPN stayed on
  after returning to the safe zone.
- ✅ **Tied to per-app time limits**: `enforceTimeLimits` now runs in the
  foreground too, and the effective (time-limit-adjusted) whitelist feeds both the
  accessibility blocker AND the VPN — so an app that exhausts its daily budget
  **also loses internet**, not just its foreground access.
- ✅ **Tamper reporting wired end-to-end**: `onRevoke` writes `vpn_revoked`; the
  heartbeat compliance matrix now **reports** it, the Security panel shows a
  warning, and a fresh successful (re)establish clears it.
- ✅ **Whitelist + time limits also reconciled natively (works with UI closed).**
  Dart publishes the raw base whitelist as a plain JSON string (`eg_base_whitelist`);
  `AppBlockerService` reads it + today's usage (native `UsageStatsManager`) + the
  policy/feature-flags and computes the effective `native_whitelist` itself every 5s.
  So an admin whitelist change AND a per-app **time limit** now take effect — blocking
  *and* the VPN internet cut — even while the app is fully closed, no longer only when
  the Command Center is open.
- ⚠️ Must still be **tested on a real device**. Caveats: one VPN at a time; user can
  disable it on BYOD (tamper flag set + reported); status-bar key icon.

### C. Auto-start / auto-foreground on zone entry  *(in progress)*
- ✅ **Shipped:** on NEW zone entry (and not yet verified/locked) the background
  loop fires a **full-screen-intent notification** that brings the app forward to
  authenticate; it's cancelled on exit. New `USE_FULL_SCREEN_INTENT` permission +
  a dedicated high-importance `guardian_alerts` channel.
- ⬜ To do (future): wake-if-killed via the Android **Geofencing API** (OS triggers
  the app on geofence transition). The always-on foreground service already keeps
  the app alive in the common case.

### D. Admin configuration — DB-driven for now  *(web dashboard deferred)*
Decision: **no web dashboard yet.** All admin config is done directly in the
database (Neon SQL) — see **`ADMIN_DB_GUIDE.md`** for copy-paste commands:
geofence, global + per-device whitelist, per-app time limits, feature keys,
lock/unlock, QR/password, delete device. No code change needed — the server +
app already read and sync these values.
- Future (optional): a web dashboard that simply wraps these same DB operations
  in a UI, and displays the zone QR (server already has `/api/qr-current`).

### E. OEM background-reliability hardening  *(in progress)*
Per-OEM onboarding deep-links to keep the service alive on aggressive skins.
- ✅ **Auto-start helper shipped** — native `openAutoStartSettings` tries known
  MIUI/ColorOS/Funtouch/OneUI/EMUI/OnePlus activities (falls back to app details);
  surfaced as an "Auto-start / keep alive (OEM)" tile.
- ✅ **Now MANDATORY (acknowledgement-based)** — Android exposes no API to read the
  auto-start toggle, so this is satisfied by a one-time **acknowledgement** (the
  user has opened the OEM screen), tracked as `autostart_ack` and required for
  compliance + to seal the device (setup step 9).
- ✅ **Settings grace window fixes "opens then closes"** — opening the OEM/app-details
  page used to trip the accessibility **anti-tamper shield** (it detects "Env
  Guardian" + "Force stop" on `com.android.settings` and jumps HOME), so the screen
  closed instantly. Tapping any compliance settings tile now writes
  `enforcement_grace_until` (~45s); `AppBlockerService` stands down while it's active.
- ⬜ To do: a watchdog / restart strategy and clearer per-OEM instructions.

### F. Security hardening  *(shipped — staged)*
- ✅ **Per-device tokens**: a random `device_token` is issued at registration
  (`agents.device_token`), returned to the app, stored, and sent as `x-device-token`
  on heartbeat + agent-status.
- ✅ **Opt-in enforcement**: set server env `ENFORCE_DEVICE_TOKEN=true` to require a
  matching token (devices without one yet get a grace pass, so nothing breaks).
  Roll out: deploy → let devices re-register/obtain tokens → then flip enforcement on.
- ⬜ Remaining: move the shared API key out of the APK source (build-time
  `--dart-define`); rotate the shared key once per-device tokens are enforced fleet-wide.

### G. Dynamic / rotating QR  *(shipped, opt-in)*
- ✅ Time-based QR codes: when `system_settings.qr_mode = 'totp'`, the valid QR is
  an HMAC-SHA256 code over a 30s window derived from `qr_secret` (server + app
  compute it identically; app accepts ±1 window for clock skew). Default stays
  `'static'`, so existing printed QRs keep working.
- ⚠️ Needs a **live display** of `/api/qr-current` (it now returns the current
  rotating value) — a printed paper QR can't rotate. Practical once a dashboard /
  zone screen renders it. Enable via DB: `UPDATE system_settings SET qr_mode='totp'`.

### H. Production readiness  *(partly shipped)*
- ✅ **Application ID changed** to `com.envguardian.mdm` (Kotlin `namespace` kept as
  `com.example.env_guardian` so channels/components/source don't move). Runtime
  self-package references updated (blocker self-check now uses `packageName`;
  Armory self-skip, iron_pulse path, and the running-apps self-filter use the new id).
- ⬜ Distribution plan: ship as a **direct/private APK** (accessibility + VPN +
  usage/notification access are Play-policy sensitive). MDM/enterprise channel
  recommended over the public Play Store.
- ⚠️ Verify on device: app installs under the new id and does not block itself in-zone.

### I. Polish / optional
- Notification timer that ticks every second via native chronometer
- **Samsung Knox** enhanced enforcement mode (stronger control on Samsung, no reset)
- Network/Wi-Fi-level enforcement (org firewall/NAC) as a device-agnostic complement
- End-to-end verification of per-app time limits (now enforced NATIVELY so they
  apply even with the app closed — see Feature B; still to be verified on a device)
