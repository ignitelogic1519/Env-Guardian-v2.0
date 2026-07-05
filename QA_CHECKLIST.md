# Env Guardian — Final QA Checklist (integrity & user stories)

End-to-end, situation-based checklist to validate the **whole system** after the
A–I rollout. Complements the granular [`TEST_CASES.md`](TEST_CASES.md). Walk each
user story on a **real device** and mark **Pass / Fail / Blocked**.

---

## 0. Pre-requisites (do this first)

### 0.1 Database changes (auto-applied — just redeploy)
This release adds two columns; the server's idempotent migration creates them on
startup, so **no manual SQL is required** — just redeploy the server:

| Table | New column | Purpose |
|-------|-----------|---------|
| `agents` | `device_token text` | Feature F per-device token |
| `system_settings` | `qr_mode varchar(10)` (default `'static'`) | Feature G QR rotation |

After redeploy, confirm in the Render logs: `✅ Schema ready (NN/NN steps applied)`.
Verify (optional) in Neon:
```sql
SELECT device_token FROM public.agents LIMIT 1;
SELECT qr_mode FROM public.system_settings WHERE id = 1;   -- expect 'static'
```

### 0.2 Server configuration (env vars)
| Var | Set when | Effect |
|-----|----------|--------|
| `ENFORCE_DEVICE_TOKEN` | **Leave `false` for now** | When `true`, device calls must carry a valid `x-device-token`. Flip on only AFTER all devices have re-registered and obtained a token. |
| `qr_mode` (DB, not env) | Keep `static` unless you have a live QR display | `'totp'` = rotating QR |

### 0.3 Build + permissions
Build from the feature branch (`flutter pub get && flutter build apk`). On the
device grant the **7 core** permissions from the "Compliance Required" screen:
Location (always), GPS, Camera, Notifications, Battery, Overlay, **Accessibility**.
Then open the **Security Features** panel (⚙/tune icon, top-right of the Command
Center — available at any time, in or out of the zone) to enable the **optional**
protections: **Usage Access**, **Notification Access**, **Auto-start** (OEM), and
**Network Guard (VPN consent)**.

---

## 1. User story: new employee onboarding (fresh device)
**Situation:** brand-new install, employee sets up their phone.
- [ ] Enter name + ID, grant every permission, seal & register → lands on Command Center.
- [ ] `agents` row created with `android_version`, `sdk_int`, and a non-null `device_token`.
- [ ] Heartbeat updates `last_pulse`/location; device shows **online** in DB.

## 2. User story: lost/stolen device re-claim attempt
**Situation:** someone tries to re-register the device as a different person.
- [ ] Reinstall + register **same** name/ID → allowed (reinstall path).
- [ ] Register **different** name/ID on that device → blocked with "already registered to another employee".
- [ ] Admin deletes the device in DB → it can be registered by a new identity again.

## 3. User story: walking INTO the restricted zone
**Situation:** employee physically enters the geofence.
- [ ] Zone detected; **full-screen prompt** brings the app forward (feature C).
- [ ] If not compliant, the compliance panel lists exactly what's missing.
- [ ] Map tab shows the red zone + **INSIDE ZONE** badge + the device marker.

## 4. User story: pre-scan clean-state gate (feature A)
**Situation:** a non-whitelisted app (e.g. background YouTube music) is running.
- [ ] With Notification Access granted, the QR scanner is replaced by **"Close these apps"** listing the offender(s).
- [ ] Close the app (swipe from Recents) → tap **Re-check** → scanner unlocks.
- [ ] A whitelisted app running in the background does **not** block scanning.

## 5. User story: authenticating + time-in-zone
- [ ] Scan the correct QR → **Secure Zone Active**, timer starts (screen + notification).
- [ ] Timer ticks on screen each second; notification shows `⏱ HH:MM:SS`.

## 6. User story: working inside the zone (enforcement)
- [ ] Open a non-whitelisted app → kicked to home; logged `[BLOCKED]`.
- [ ] Open a whitelisted app → allowed; logged `[ALLOWED]`.
- [ ] **Time limit:** with the feature key on + a limit set, the app is allowed until the daily budget is hit, then blocked.
- [ ] **Time limit + Network Guard on:** once the app hits its budget it also **loses internet** (not just foreground access) within ~10s.

## 7. User story: Network Guard (feature B — experimental)
**Situation:** admin wants non-whitelisted apps to also lose internet in-zone.
- [ ] On a **fully compliant** device, open **Security Features** (app-bar) → toggle **Network Guard on** → one-time VPN consent appears and is accepted (this is the fix: consent is reachable after setup, not only on the compliance screen).
- [ ] Enter the zone → VPN key icon appears; a non-whitelisted app has **no internet**; a whitelisted app still works.
- [ ] **With the app closed (swiped away):** the guard still starts on zone entry / stops on exit (driven by the background loop — note the device model + Android version, as this depends on background channel access).
- [ ] Toggle **Network Guard off** in the panel → tunnel stops; internet restored.
- [ ] Leave the zone → VPN stops; internet restored for all.
- [ ] Disable the VPN from system Settings while in-zone → `vpn_revoked` flag set; the **Security panel shows a tamper warning**, the app-bar icon turns orange, and the heartbeat `compliance_status.vpn_revoked` is **true** in the DB. Re-enabling / a successful re-establish clears it.

## 8. User story: leaving the zone (clean teardown)
- [ ] Verification cleared; **timer resets**; VPN off; apps unblocked; "Safe Zone".

## 9. User story: admin makes a change via the database
**Situation:** no dashboard — admin edits the DB (see `ADMIN_DB_GUIDE.md`).
- [ ] Change geofence → device reflects new zone within ~10s.
- [ ] Add/remove a global or per-device whitelist app → enforced within ~10s.
- [ ] Set a per-app time limit / feature flag → enforced.
- [ ] Set `admin_lock=true` → device freezes; set false → unfreezes.

## 10. User story: tamper attempts (all should be detected)
- [ ] Disable Accessibility → "Enforcer offline" + compliance fail.
- [ ] Revoke Usage Access → time limits stop (fail-open) + tile turns red.
- [ ] Revoke Notification Access → pre-scan gate fails open (scanner shown) + tile red.
- [ ] Force-stop via Settings in-zone → anti-tamper returns to home.
- [ ] With Network Guard on, disable the VPN on the device → `vpn_revoked` reported to the server (compliance matrix) + tamper warning in the Security panel.

## 11. User story: reliability across conditions
- [ ] Reboot → service auto-starts; still monitoring.
- [ ] App swiped away → background monitor + notification persist.
- [ ] Aggressive OEM (Xiaomi/Oppo/Realme) → after enabling Auto-start + battery exemption, survives 30+ min.
- [ ] Offline / airplane mode → no crash; recovers and resyncs.

## 12. User story: per-device token enforcement rollout (feature F)
**Situation:** hardening once the fleet has tokens.
- [ ] With `ENFORCE_DEVICE_TOKEN=false`: everything works (tokens issued silently).
- [ ] After devices have re-registered, set `ENFORCE_DEVICE_TOKEN=true` + redeploy.
- [ ] A tokened device keeps working; a request without/with a wrong token → `403`.

## 13. User story: rotating QR (feature G — only if enabled)
- [ ] Set `qr_mode='totp'`; show `/api/qr-current` on a live display.
- [ ] Scanning the current code authenticates; an old screenshot (older window) fails.

---

## Integrity sign-off
- [ ] All "Pass" with no Sev-1 failures (block / freeze / crash).
- [ ] Server logs clean (`Database connected`, `Schema ready`, no repeated 500s).
- [ ] DB spot-check: agent online, `android_version`/`device_token` set, settings synced.
- [ ] Note any **experimental** feature (A, B) results separately with device model + Android version.
