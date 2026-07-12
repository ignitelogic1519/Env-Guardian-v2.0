# Env Guardian — Admin Guide (Database-driven)

> The **[web admin console](dashboard/README.md)** is now the primary way to
> administer the system. This SQL guide remains a **fallback** for direct
> database administration (Neon → SQL Editor) — handy for automation, recovery,
> or when you'd rather not open the console. The console wraps these same
> operations.

**All admin configuration can be done directly in the database.** The server and
app already read these values and sync them to every device automatically
(devices pick up changes within ~10s).

No code/redeploy is needed for any of these — just run the SQL.

> ⚠️ All settings live in **one row**: `system_settings` where `id = 1`.
> Per-device settings live in the `agents` row matching that `emp_id`.

---

## 0. See what you have

```sql
-- Current global settings
SELECT * FROM public.system_settings WHERE id = 1;

-- All registered devices + live status
SELECT emp_id, emp_name, device_model, android_version, sdk_int,
       in_zone, admin_lock, auto_lock, last_pulse
FROM public.agents
ORDER BY last_pulse DESC;

-- What apps are installed on a device (handy to copy exact package names)
SELECT installed_apps FROM public.agents WHERE emp_id = 'EMP123';
```

---

## 1. Restricted zone (geofence)

```sql
UPDATE public.system_settings
SET geofence_polygon = '[
  {"lat": 21.183031, "lng": 72.785091},
  {"lat": 21.183360, "lng": 72.787155},
  {"lat": 21.185533, "lng": 72.786946},
  {"lat": 21.185101, "lng": 72.784320}
]'::jsonb,
    updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE id = 1;
```
Use 3+ corner points, listed in order around the area.

---

## 2. Application whitelist (which apps are allowed in the zone)

There are **two** lists; the device uses the union of both.

### a) Global whitelist — applies to ALL devices, admin-controlled
*(employees cannot change this — use it for org-wide policy)*
```sql
-- Replace the whole list:
UPDATE public.system_settings
SET whitelisted_apps = '["com.whatsapp", "com.android.chrome"]'::jsonb,
    updated_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE id = 1;

-- Add one app (keeps the rest):
UPDATE public.system_settings
SET whitelisted_apps = whitelisted_apps || '["com.google.android.gm"]'::jsonb
WHERE id = 1;
```

### b) Per-device whitelist — applies to one employee
*(note: the employee can also edit this from the in-app Armory)*
```sql
UPDATE public.agents
SET custom_whitelist = '["com.whatsapp", "com.microsoft.teams"]'::jsonb
WHERE emp_id = 'EMP123';
```

> 💡 Common package names: YouTube `com.google.android.youtube`, WhatsApp
> `com.whatsapp`, Chrome `com.android.chrome`, Gmail `com.google.android.gm`,
> Instagram `com.instagram.android`, Teams `com.microsoft.teams`.

---

## 3. Per-app daily time limits

Two steps: (1) unlock the feature for the user, (2) add the limit.

```sql
-- 1) Enable the time-limit feature for this user
UPDATE public.agents
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"app_time_limits": true}'::jsonb
WHERE emp_id = 'EMP123';

-- 2) Allow YouTube for 30 minutes/day (1800000 ms)
INSERT INTO public.app_policies (emp_id, package, daily_limit_ms, enabled, updated_at)
VALUES ('EMP123', 'com.google.android.youtube', 1800000, true,
        (EXTRACT(EPOCH FROM now()) * 1000)::bigint)
ON CONFLICT (emp_id, package) DO UPDATE
  SET daily_limit_ms = EXCLUDED.daily_limit_ms,
      enabled        = EXCLUDED.enabled,
      updated_at     = EXCLUDED.updated_at;
```
Other cases:
```sql
-- Block an app entirely (always blocked in the zone)
INSERT INTO public.app_policies (emp_id, package, daily_limit_ms, enabled, updated_at)
VALUES ('EMP123', 'com.instagram.android', 0, false, (EXTRACT(EPOCH FROM now())*1000)::bigint)
ON CONFLICT (emp_id, package) DO UPDATE SET enabled = false, updated_at = EXCLUDED.updated_at;

-- Remove a limit (no restriction on that app)
DELETE FROM public.app_policies WHERE emp_id = 'EMP123' AND package = 'com.google.android.youtube';
```
Handy ms values: 15 min = `900000`, 30 min = `1800000`, 1 hr = `3600000`, 2 hr = `7200000`.

---

## 4. Lock / unlock a device

```sql
-- Admin lock (freezes the device — "banishment")
UPDATE public.agents SET admin_lock = true  WHERE emp_id = 'EMP123';
-- Unlock
UPDATE public.agents SET admin_lock = false WHERE emp_id = 'EMP123';

-- Clear a time-anomaly auto-lock (if it tripped)
UPDATE public.agents SET auto_lock = false WHERE emp_id = 'EMP123';
```

---

## 5. QR secret + admin password

```sql
-- Rotate the zone QR value (then regenerate the QR image for that string)
UPDATE public.system_settings
SET qr_secret = 'ZONE-NEW-VALUE', updated_at = (EXTRACT(EPOCH FROM now())*1000)::bigint
WHERE id = 1;

-- Change the admin password (used to unlock the vault / unfreeze)
UPDATE public.system_settings
SET admin_password = 'NewStrongPassword', updated_at = (EXTRACT(EPOCH FROM now())*1000)::bigint
WHERE id = 1;

-- (Optional) Rotating QR: 'totp' = time-based code (needs a live display of
-- /api/qr-current, e.g. a zone screen); 'static' = fixed printed QR (default).
UPDATE public.system_settings SET qr_mode = 'totp'   WHERE id = 1;  -- enable rotation
UPDATE public.system_settings SET qr_mode = 'static' WHERE id = 1;  -- back to static
```

---

## 6. Remove / re-assign a device

A device is bound to its first owner, so to let someone re-register a device you
must delete it first:
```sql
DELETE FROM public.app_usage    WHERE emp_id = 'EMP123';
DELETE FROM public.app_policies WHERE emp_id = 'EMP123';
DELETE FROM public.agents       WHERE emp_id = 'EMP123';
```

---

*The web dashboard (backlog item D) wraps these same database operations in a UI —
see [`dashboard/README.md`](dashboard/README.md). Use whichever fits the task.*
