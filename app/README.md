# Env Guardian v2.0 — Mobile App

The Flutter mobile application that runs on each employee's device.

> ⏳ **Status:** placeholder. The application code will be added in a later step
> (Step 5 of the roadmap in the root [README](../README.md)).

## What this app will do

- Register the device with the central server.
- Continuously run in the background and report device status (a "heartbeat").
- Detect when the device enters a restricted zone (geofence).
- Enforce a zero-trust policy in the zone: block non-approved apps.
- Require QR-code authentication to operate inside the zone.
- Track time spent in the zone and per-app usage.

## Planned structure (feature-first)

Each feature will live in its own folder so the code is easy to manage and can be
shared across developers. The detailed layout will be added together with the code.
