# Env Guardian v2.0

A Mobile Device Management (MDM) solution for **Bring Your Own Device (BYOD)** environments.

When an employee's phone enters a defined restricted zone (geofence), Env Guardian
enforces a "zero trust" policy: only approved apps may be used, the user must pass a
physical QR authentication, and the device's compliance and activity are reported to a
central server in real time.

This is the version 2.0 rebuild — focused on **stronger security**, **more functionality**,
**wider device compatibility**, and a **modular, developer-friendly codebase**.

---

## Repository layout (monorepo)

For now, both halves of the project live in this single repository so they are easy to
build and manage together. When it is time to deploy, the `server/` folder will be copied
into its own repository (`Env-Guardian-Server-v2.0`) for clean hosting on Render.

```
env-guardian-v2.0/
├── app/        # The mobile application (Flutter) — runs on the employee's phone
├── server/     # The backend (Node.js + PostgreSQL) — the central control + database
└── README.md   # You are here
```

| Folder | What it is | Hosted on |
|--------|-----------|-----------|
| `app/`    | The Flutter mobile app installed on devices | Built as an APK |
| `server/` | The Node.js API + database schema            | Render.com (free tier) + Neon PostgreSQL |

> **Why one repo for now?** Keeping everything together while building reduces confusion
> and keeps versions in sync. The `server/` folder is self-contained, so it can be moved
> to its own repository later without any loss.

---

## Build roadmap

The project is being built **one step at a time**:

1. ✅ **Repo skeleton** — create the `app/` and `server/` structure _(current step)_
2. ⬜ Add the existing server code into `server/`
3. ⬜ Create the database on [Neon](https://console.neon.tech/)
4. ⬜ Host the server on [Render](https://render.com/)
5. ⬜ Set up the app in `app/` and connect it to the server
6. ⬜ Add new features: Android-version reporting, zone timer, per-app time limits, neumorphic UI

---

## Documentation

Each folder has its own `README.md` with details specific to that part of the project.
