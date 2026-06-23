# Env Guardian v2.0 — Backend Server

The Node.js + Express API and PostgreSQL database that act as the central control point.

> ⏳ **Status:** placeholder. The existing server code will be added in the next step
> (Step 2 of the roadmap in the root [README](../README.md)).

## What this server does

- Stores all registered devices ("agents") and their live status.
- Provides the API the mobile app talks to (register, heartbeat, settings, etc.).
- Provides the API the admin dashboard uses to monitor and control devices.
- Auto-creates its own database tables on first startup.

## Hosting (planned)

- **Database:** [Neon](https://console.neon.tech/) — free serverless PostgreSQL.
- **Server:** [Render](https://render.com/) — free web service hosting.

When ready, the contents of this folder will be copied into the dedicated
`Env-Guardian-Server-v2.0` repository for deployment.
