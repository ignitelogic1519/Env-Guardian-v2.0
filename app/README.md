# Env Guardian v2.0 — Mobile App

The Flutter mobile application that runs on each employee's device.

> ✅ **Status:** baseline added. This is the working version 1.0 app, brought in
> unchanged as our starting point (Step 5a). Next we connect it to the new server
> (Step 5b), then refactor into a modular structure and add new features (Step 6).

## What this app does

- Registers the device with the central server.
- Runs in the background and reports device status (a "heartbeat").
- Detects when the device enters a restricted zone (geofence).
- Enforces a zero-trust policy in the zone: blocks non-approved apps.
- Requires QR-code authentication to operate inside the zone.

## Key files (current baseline)

| File | Purpose |
|------|---------|
| `lib/main.dart`       | The whole app: setup, command center, blocker logic, UI |
| `lib/cloud_sync.dart` | Talks to the backend server (register, heartbeat, settings) |
| `pubspec.yaml`        | App dependencies |
| `android/`            | Android project + native `AppBlockerService` (the enforcer) |

> ⚠️ This baseline still points at the old server URL and uses the old API key.
> Those are updated in Step 5b so the app talks to *your* new Render server.

## Building the app (for later)

Requires the Flutter SDK. From this `app/` folder:

```bash
flutter pub get      # download dependencies
flutter run          # run on a connected device/emulator
flutter build apk    # build an installable APK
```
