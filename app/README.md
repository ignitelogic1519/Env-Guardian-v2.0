# Env Guardian v2.0 — Mobile App

The Flutter mobile application (the device agent) that runs on each employee's
device. Android is the only actively targeted platform; the other platform
folders are the default Flutter scaffold.

> ✅ **Status:** shipped. The app is connected to the server, refactored into the
> modular feature-first layout below, and all A–I rollout features are in
> (see the root [BACKLOG](../BACKLOG.md)). Production application id:
> **`com.envguardian.mdm`** (distribution = direct/private APK).

## What this app does

- Registers the device with the central server.
- Runs in the background and reports device status (a "heartbeat").
- Detects when the device enters a restricted zone (geofence).
- Enforces a zero-trust policy in the zone: blocks non-approved apps.
- Requires QR-code authentication to operate inside the zone.

## Project structure (feature-first)

The app is organised so each piece of functionality lives in its own file and
can be owned/extended independently by different developers:

```
lib/
├── main.dart                  # entry point only (bootstrap)
├── app.dart                   # root MaterialApp + which screen to show
├── cloud_sync.dart            # all backend API calls
├── core/
│   ├── platform.dart          # the native platform channel (shared)
│   ├── background_service.dart# the always-on "ghost" monitor + helpers
│   └── theme/
│       ├── glass.dart         # glassmorphism design system (frosted panels)
│       └── neumorphic.dart    # neumorphic design system (NeuCard, theme…)
└── features/
    ├── onboarding/            # first-run setup & device registration
    ├── command_center/        # main tabbed screen, QR auth, zone timer
    ├── armory/                # admin app-whitelist vault
    ├── map/                   # restricted-zone map
    └── logs/                  # live allow/block log feed
```

| Area | Purpose |
|------|---------|
| `core/background_service.dart` | The 10-second monitor loop: location, compliance, time-limit enforcement, notifications. Hosts the shared `enforceTimeLimits()` + `reconcileVpn()` helpers so per-app time limits and the Network Guard VPN run identically from the loop and the UI |
| `core/platform.dart`           | Shared `MethodChannel` to the native Android blocker / usage-stats / VPN |
| `features/command_center/`     | Main tabbed screen + QR auth + zone timer + the app-bar **Security Features** panel (manages Usage Access, Notification Access, OEM Auto-start; shows the always-on Network Guard status + re-grant) |
| `features/onboarding/`         | First-run setup: identity + **all 10 mandatory grants (steps 0–9)** — runtime permissions, Accessibility, one-time Network Guard (VPN) consent, and the now-required Usage Access, Notification Access & OEM Auto-start (acknowledgement). Device can't be sealed until all pass |
| `features/*`                   | One folder per feature — safe to assign to different developers |
| `android/`                     | Android project + native `AppBlockerService` (the enforcer) + usage-stats |

## Building the app (for later)

Requires the Flutter SDK. From this `app/` folder:

```bash
flutter pub get      # download dependencies
flutter run          # run on a connected device/emulator
flutter build apk    # build an installable APK
```
