# Formal Introduction — Env Guardian v2.0

**Document type:** Formal product introduction for regulatory / legal review
**Prepared for:** Government of India — Information Technology review
**Product name:** Env Guardian (Version 2.0)
**Product category:** Mobile Device Management (MDM) / Zero-Trust workplace security solution for Bring-Your-Own-Device (BYOD) environments
**Date:** 12 July 2026

---

## 1. Executive Summary

Env Guardian is a location-aware workplace security system for organisations that permit employees to carry their **personal Android smartphones** into sensitive premises. The product enforces an organisation's device-usage policy **only while a device is physically inside a designated restricted zone** (for example, an examination hall, a data centre floor, a research laboratory, or a secure office wing). The moment the device leaves the zone, all restrictions are lifted automatically and the phone returns to fully normal personal use.

Env Guardian is deliberately designed as a **consent-based, BYOD-first** product:

- It is installed as a normal application with the user's knowledge and explicit permission grants during a guided setup.
- It does **not** take ownership of the device, does **not** require corporate enrolment or a factory reset, and has **no ability** to wipe, read personal content from, or remotely control the device beyond the declared policy functions.
- Enforcement is honest by design: it is **deterrent-grade and tamper-detected**, not covert. The user always sees a persistent on-screen notification while monitoring is active.

---

## 2. System Components

The solution consists of four clearly separated components.

### 2.1 The Mobile Application (the "Device Agent")

An Android application built with the **Flutter framework (Dart)** with native **Kotlin** service components. It is installed on the employee's personal device through **direct, private distribution** (a signed APK provided by the organisation), under the production application identifier `com.envguardian.mdm`. It performs on-device policy checks, presence verification, and status reporting.

### 2.2 The Backend Server

A **Node.js / Express** REST API service backed by a **PostgreSQL** relational database, hosted on standard cloud infrastructure and served exclusively over **HTTPS (TLS-encrypted)** connections. The server stores organisational configuration (zone boundaries, approved-application lists, usage policies), receives periodic status reports ("heartbeats") from enrolled devices, and exposes administrative APIs. All API access is authenticated (API key for devices, token-based sessions for administrators).

### 2.3 The Administration Dashboard

A browser-based administrative console (a static single-page web application built with standard **HTML, CSS and JavaScript**) used by the organisation's authorised staff. It provides fleet overview, device compliance status, policy configuration, enrolment management, risk alerts, and user administration. Access is protected by **login credentials with JSON Web Token (JWT) sessions**, and every action is gated by **role-based access control** (Administrator / Manager / Viewer) enforced on the server side.

### 2.4 The Public Website

A static, informational marketing website describing the product, its features, and industry use cases, with a contact form for demonstration requests. The website collects no personal data and runs no user-tracking or profiling code.

---

## 3. How the System Works (Operational Flow)

1. **Enrolment.** The employee installs the application and completes a guided first-run setup: entering their name and employee ID, and granting each required permission with a clear on-screen explanation. The device is registered with the organisation's server and "sealed" for monitoring.
2. **Zone definition.** The organisation's administrator defines the restricted zone as a geographic boundary (a polygon) in the dashboard. This boundary is the sole trigger for enforcement.
3. **Outside the zone.** The application remains passive. No application blocking, no network restriction, and no usage measurement takes place. The phone behaves as an ordinary personal device.
4. **Entering the zone.** The application detects zone entry using the device's own GPS position and prompts the employee to verify their presence by scanning a **physical QR code** displayed at the premises (a static code, or optionally a time-rotating one-time code for higher assurance).
5. **Inside the zone.** The organisation's policy applies: only **approved (whitelisted) applications** may be used; non-approved applications are returned to the home screen and may optionally lose internet access; optional **per-application daily time limits** apply to in-zone usage only; and the device reports its compliance status to the server.
6. **Leaving the zone.** All restrictions cease immediately and automatically. The in-zone session timer resets.

---

## 4. Methods and Techniques Used

All techniques rely exclusively on **official, documented Android platform capabilities** granted by the user. No rooting, no exploitation of vulnerabilities, and no undocumented interfaces are used.

| Function | Technique (standard Android capability) |
|---|---|
| Restricted-zone detection | GPS location with a point-in-polygon geofence check performed on the device |
| Presence verification | Camera-based QR code scanning, validated against a server-held secret (static or time-based one-time code) |
| Approved-app enforcement | Android Accessibility Service that identifies the foreground application and returns non-approved applications to the home screen while in-zone |
| In-zone network control | A local, on-device VPN service (established only with the user's one-time system consent) that withholds internet from non-approved applications while in-zone; no traffic is inspected, decrypted or routed off-device |
| Time-limit measurement | Android Usage Access statistics, counted **only** for time spent inside the zone |
| Pre-entry clean-state check | Android Notification Access, used solely to identify applications actively running before QR verification |
| Continuous operation | A standard Android foreground service with a **permanently visible notification**, so monitoring is never hidden from the user |
| Tamper awareness | Detection and server reporting of attempts to disable, force-stop or uninstall the agent while in-zone (the platform ultimately allows the user to remove the app; enforcement is a deterrent, not an irreversible lock) |
| Device–server communication | Authenticated REST calls over HTTPS; periodic heartbeat reports |

---

## 5. Permissions Requested and Their Purpose

Every permission is requested transparently during setup with an explanation, and each maps to exactly one declared function:

| Permission | Purpose |
|---|---|
| Location (including background) | Determine whether the device is inside or outside the restricted zone |
| Camera | Scan the physical QR verification code |
| Notifications | Show the mandatory persistent monitoring notification and status alerts |
| Accessibility Service | Enforce the approved-application policy inside the zone |
| VPN consent (one-time) | Restrict internet access of non-approved applications inside the zone |
| Usage Access | Measure in-zone application usage against daily time limits |
| Notification Access | Identify actively running applications for the pre-entry clean-state check |
| Battery-optimisation exemption / auto-start | Keep the monitoring service reliably running while enrolled |
| Display over other apps | Present lock and verification screens when required |

The application **cannot and does not**: read messages, e-mails, photos, files, contacts or call logs; record audio or video; inspect or intercept network content; wipe or factory-reset the device; or operate any of the above functions outside the restricted zone.

---

## 6. Data Handled, Privacy and Retention

Env Guardian follows a **data-minimisation** approach consistent with the principles of India's Digital Personal Data Protection framework:

- **Data collected:** employee name and employee ID (provided by the user at enrolment); device make, model and OS version; device location and in-zone/out-of-zone state; compliance status of granted permissions; battery level; the list of installed application package names; and per-application usage time **accrued inside the zone only**.
- **Data not collected:** no personal content (messages, media, files, contacts), no browsing content, no keystrokes, no audio/video capture, and no network traffic content.
- **Purpose limitation:** all data is used solely for premises security policy enforcement and compliance reporting to the enrolling organisation.
- **Retention:** non-essential history (application-usage records and console login events) is automatically purged after a short retention window (10 days by default). Live device event logs are held only in short-lived server memory unless an administrator explicitly enables temporary capture, in which case captured records are automatically deleted after one day.
- **Transparency:** the device shows a persistent notification whenever monitoring is active, and an in-app **Policy tab** lets the user see every policy currently applied to their device.
- **Anti-theft safeguard:** a device is permanently bound to the identity that first enrolled it; a lost or stolen device cannot be re-registered under another identity without administrator intervention.

---

## 7. Security Measures

- All device-to-server and dashboard-to-server communication occurs over **HTTPS/TLS**.
- Device API access requires an organisation **API key**, with optional **per-device authentication tokens** for stronger device identity.
- Dashboard access requires credential login with **JWT sessions**; all administrative actions are authorised **server-side** by role (Administrator / Manager / Viewer).
- Secrets (keys, passwords, tokens) are held server-side only and are never embedded in web pages or exposed to browsers.
- The server applies standard web hardening (security headers, controlled cross-origin policy, request logging) and **refuses to start in production with insecure default secrets**.
- A continuous **risk-alert engine** notifies administrators of high-signal events, such as a device going silent while inside the restricted zone, the network guard being disabled in-zone, or critically low battery.

---

## 8. Benefits

- **Protects sensitive premises** — prevents unauthorised app use, data capture and distraction inside examination halls, data centres, R&D facilities, defence and government offices, healthcare records areas, financial floors, and similar controlled environments.
- **Respects personal ownership** — employees keep full, unrestricted use of their own phones everywhere outside the defined zone; the organisation never gains control over the personal device as a whole.
- **Transparent and consent-driven** — every capability is granted knowingly by the user; monitoring is always visibly indicated; applied policies are viewable in-app.
- **Verifiable presence** — the physical QR verification ties policy activation to genuine physical presence, not merely GPS coordinates.
- **Accountable administration** — role-based access, server-side authorisation, audit-oriented metrics, and automatic risk alerts give the organisation a controlled, reviewable administration model.
- **Cost-effective and portable** — built entirely on open, standard technologies (Flutter, Kotlin, Node.js, PostgreSQL, standard web technologies), with no dependency on proprietary device-manufacturer programmes.

---

## 9. Current Status, Plans and Preparations

**Current status.** Version 2.0 is feature-complete in code across all four components. Core capabilities — enrolment and device sealing, geofencing, QR verification (static and rotating), approved-app enforcement, in-zone network control, per-app in-zone time limits, compliance scoring, remote lock, fleet dashboard with role-based access, risk alerts, and battery telemetry — are implemented and documented. The two most hardware-sensitive protections (the pre-entry clean-state gate and the in-zone network guard) are complete in code and are undergoing verification on physical devices across manufacturers before being declared production-hardened.

**Quality preparations.** The project maintains a formal manual test plan, an end-to-end user-story integrity checklist, and server smoke tests, which together form the acceptance gate for each release.

**Planned enhancements** (tracked in the project backlog):

- Operating-system-level geofence wake-up (Android Geofencing API) as a supplementary trigger alongside the existing always-on service.
- Additional enforcement polish, including enhanced notification timers, deeper integration with manufacturer enterprise frameworks, and Wi-Fi-based presence enforcement.
- Continued multi-manufacturer device compatibility testing (covering the major Android vendor customisations prevalent in the Indian market).

**Distribution model.** The application is distributed privately and directly by the deploying organisation to its enrolled employees as a signed installation package; it is not a public consumer application.

---

## 10. Declaration of Design Principles

1. **Consent first** — no capability operates without an explicit, informed user grant.
2. **Zone-bound enforcement** — no restriction, measurement or usage tracking occurs outside the defined restricted zone.
3. **Visibility** — active monitoring is always indicated to the user; nothing is covert.
4. **Data minimisation** — only operationally necessary data is collected, retained briefly, and used solely for the declared security purpose.
5. **Standard platform capabilities only** — no rooting, no exploits, no hidden interfaces; the device owner retains ultimate control of their personal device.

---

*This document provides a surface-level formal introduction for review purposes. Detailed technical documentation, administration guides, and test plans are maintained within the project repository and can be furnished on request.*
