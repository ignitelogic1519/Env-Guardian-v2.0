# Env Guardian — Test Cases

Manual QA test plan covering every functionality, plus server smoke tests.
Mark each run: **Pass / Fail / Blocked**. "DB" steps = run SQL in Neon
(see `ADMIN_DB_GUIDE.md`). The device picks up server/DB changes within ~10s.

Legend: 🟢 happy path · 🔴 negative/edge · ⚙️ setup/config

---

## 1. Registration & anti-theft binding

| ID | Type | Preconditions | Steps | Expected |
|----|------|---------------|-------|----------|
| REG-01 | 🟢 | Fresh install, server up | Enter name + ID, grant all permissions, tap "Seal Device & Register" | HTTP 201; device sealed; lands on Command Center; row appears in `agents` |
| REG-02 | 🔴 | Fresh install | Submit with empty name or ID | Cannot seal (button hidden) / server 400 if forced |
| REG-03 | 🟢 | Device already registered to EMP-A; reinstall app | Register again as **same** EMP-A + same name | Allowed (201); metadata refreshed; binding unchanged |
| REG-04 | 🔴 | Device already registered to EMP-A | Register with a **different** name/ID | Rejected with 409 + "already registered to another employee" |
| REG-05 | 🔴 | EMP-A already exists on device 1 | Register **new device** using emp_id EMP-A | Rejected 409 (emp_id unique) |
| REG-06 | 🔴 | Airplane mode on | Attempt registration | "Could not connect to server" message; not sealed |

## 2. Background service ("the Ghost")

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| BG-01 | 🟢 | Seal device, then close the app (swipe away) | Persistent "Env Guardian" notification remains; status keeps updating |
| BG-02 | 🟢 | Reboot the phone | Service restarts automatically; notification reappears |
| BG-03 | 🔴 | Leave app closed 30+ min (esp. Xiaomi/Oppo/Realme) | Service still alive (may require battery-opt exemption / autostart) |

## 3. Geofence / zone detection

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| ZONE-01 | 🟢 | ⚙️ Set geofence around current location (DB); enter it | Status shows in-zone; notification reflects zone |
| ZONE-02 | 🟢 | While verified in-zone, leave the zone | Returns to "Safe Zone"; verification cleared; timer resets |
| ZONE-03 | 🔴 | Turn GPS/location off | "Compliance required" screen; not treated as in-zone |

## 4. Map page

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| MAP-01 | 🟢 | Open Map tab with a zone configured | Red polygon (boundary + fill) with **red corner points** + legend; auto-zoomed to fit |
| MAP-02 | 🟢 | Stand inside vs outside the zone | Badge shows **INSIDE ZONE** / **OUTSIDE ZONE** correctly |
| MAP-03 | 🔴 | Clear `geofence_polygon` (DB) | "No restricted zone configured" empty state (no endless spinner) |

## 5. QR authentication + zone timer

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| QR-01 | 🟢 | In-zone, scan the correct zone QR | Becomes **verified**; "Secure Zone Active"; timer starts |
| QR-02 | 🔴 | In-zone, scan a wrong/random QR | Stays unverified; scanner keeps waiting |
| QR-03 | 🟢 | After verifying, watch screen + notification | On-screen clock ticks each second; notification shows ⏱ time (refresh ~10s) |
| QR-04 | 🟢 | Leave the zone, return | Verification lost; timer reset to 00:00:00; must scan again |
| QR-05 | 🔴 | Try to reach the scanner while in Safe Zone | Scanner not shown (only inside zone) |
| QR-06 | ⚙️ | Rotate `qr_secret` (DB), regenerate QR image | Old QR no longer verifies; new QR does |

## 6. App blocking (accessibility enforcer)

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| BLK-01 | 🟢 | In-zone, open a **non-whitelisted** app | App is kicked back to home; entry logged in Logs tab as [BLOCKED] |
| BLK-02 | 🟢 | In-zone, open a **whitelisted** app | App opens and stays; logged as [ALLOWED] |
| BLK-03 | 🔴 | Disable the Accessibility service | "Enforcer offline" alert; compliance fails |
| BLK-04 | 🔴 | In-zone, open Settings → try to Force-stop Env Guardian | Anti-tamper sends you back to home |
| BLK-05 | 🟢 | Safe zone (outside), open any app | No blocking (enforcement only in-zone) |

## 7. Whitelist management

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| WL-01 | ⚙️🟢 | Set **global** whitelist (DB `whitelisted_apps`) | Within ~10s the listed apps are allowed in-zone; others blocked |
| WL-02 | ⚙️🟢 | Set **per-device** whitelist (DB `agents.custom_whitelist`) | That device allows the listed apps |
| WL-03 | 🟢 | In-app Armory (admin vault) toggle an app on | Pushed to server (`custom_whitelist`) + enforced |
| WL-04 | 🟢 | Global has X, custom has Y | Both X and Y allowed (union) |

## 8. Per-app daily time limits

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| TL-01 | ⚙️ | `feature_flags.app_time_limits` = false | No time-limit enforcement at all |
| TL-02 | 🟢 | Flag on; YouTube limit 30 min; use < 30 min | YouTube allowed |
| TL-03 | 🟢 | Continue until usage ≥ limit | YouTube becomes blocked (kicked to home) |
| TL-04 | 🟢 | Policy with `enabled=false` for an app | That app always blocked in-zone |
| TL-05 | 🔴 | Revoke "Usage Access" permission | Limits can't be measured → fails open (no extra blocks); Usage Access tile shows red |
| TL-06 | 🟢 | After some usage, check DB | `app_usage` rows recorded for the device/date |

## 9. Compliance & locking

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| CMP-01 | 🔴 | Revoke a permission (e.g. notifications) | Compliance fails; "Compliance required" screen lists it |
| LCK-01 | ⚙️ | Set `admin_lock=true` (DB) | Device shows **Admin Lock** frozen screen |
| LCK-02 | 🟢 | Trigger auto-lock (time anomaly in-zone) | **Auto-Lock** screen; unlock field shown |
| LCK-03 | 🟢 | Enter correct admin password on auto-lock | Device unfreezes; `auto_lock` cleared |
| LCK-04 | 🔴 | Enter wrong admin password | "Incorrect Admin Password"; stays locked |

## 10. Telemetry / settings sync

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| TEL-01 | 🟢 | After registration, query `agents` | `android_version` + `sdk_int` populated correctly |
| TEL-02 | 🟢 | Let it run | `last_pulse`, `current_lat/lng`, `in_zone`, `compliance_status` update |
| SET-01 | ⚙️🟢 | Change `geofence_polygon` (DB) | App reflects new zone within ~10s |
| SET-02 | ⚙️🟢 | Change `admin_password` (DB) | New password works for unlock (old one doesn't) |
| SET-03 | 🔴 | Call `GET /api/settings` with **no** API key | Server returns 401 (auth required) |

## 11. UI / UX

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| UI-01 | 🟢 | Launch app | Animated aurora background; frosted-glass panels; Inter/Outfit fonts |
| UI-02 | 🟢 | Switch tabs | Smooth fade transition; cards fade-in |
| UI-03 | 🔴 | First launch offline (fonts not cached) | Falls back to default font, no crash |

## 12. Resilience / edge

| ID | Type | Steps | Expected |
|----|------|-------|----------|
| EDGE-01 | 🔴 | Go offline mid-session | Last known state used; no crash; recovers when back online |
| EDGE-02 | 🔴 | Server (Render) cold-started/asleep | First request slow (~50s) then works |
| EDGE-03 | 🔴 | Toggle airplane mode repeatedly | App stays stable; resyncs |

---

## Server smoke tests (curl)

Replace `BASE` and `KEY` with your Render URL and `API_KEY`.

```bash
BASE="https://envguardian-server-j8yv.onrender.com"
KEY="YOUR_API_KEY"

# Health
curl -s $BASE/health

# Register (expect 201 first time)
curl -s -X POST $BASE/api/register -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"empName":"Test User","empId":"EMP-TEST","deviceId":"DEV-TEST","deviceModel":"Pixel 8","androidVersion":"14","sdkInt":34}'

# Re-register SAME device, DIFFERENT name (expect 409 — anti-theft)
curl -s -X POST $BASE/api/register -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"empName":"Thief","empId":"EMP-EVIL","deviceId":"DEV-TEST","deviceModel":"Pixel 8"}'

# Settings WITHOUT key (expect 401)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/settings

# Settings WITH key (expect 200 + geofence/whitelist/qr)
curl -s $BASE/api/settings -H "x-api-key: $KEY"

# Heartbeat
curl -s -X POST $BASE/api/heartbeat -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"empId":"EMP-TEST","deviceId":"DEV-TEST","lat":21.184,"lng":72.786,"inZone":true,"enforcerActive":true}'

# Agent status (admin_lock, whitelist, policies, feature_flags)
curl -s $BASE/api/agent-status/EMP-TEST -H "x-api-key: $KEY"
```

> Clean up the test device afterwards:
> `DELETE FROM public.agents WHERE emp_id = 'EMP-TEST';`
