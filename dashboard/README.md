# Env Guardian — Admin Console (`/dashboard`)

An online, role-based **admin dashboard** for the Env Guardian MDM system.
Pure static files (HTML + CSS + vanilla JS — no build step), designed to be
hosted on any free static host **separately from the backend**. It signs in
against the backend's `POST /api/auth/login` (JWT) and drives every admin
operation through the existing REST API.

**Design:** dark glassmorphism + neumorphism in a Microsoft-Intune-style shell
(left navigation rail, top bar, frosted content cards) over an animated aurora
background — matching the mobile app's Command Center look. Springy staggered
reveals, count-up KPIs, hover-lift cards, live pulse indicators; honours
`prefers-reduced-motion`.

---

## Pages & features

| Page | What it does |
|------|--------------|
| **Overview** | KPI tiles (devices, online, in-zone, compliance rate, logins today) + live device fleet cards; auto-refreshes every 20 s |
| **Devices** | Searchable/filterable fleet table → per-device panel: compliance matrix (7 checks + QR-verified), remote lock ("banishment"), per-device whitelist editor, today's app usage, unenroll |
| **Metrics** | Fleet compliance rate (hero figure), compliant vs non-compliant split, **console logins per day** (14-day chart), top apps used today, per-device compliance scores |
| **Policy Controller** | Global whitelist editor + per-device app policies: daily time limits, allow/block, and the `app_time_limits` feature key |
| **QR Settings** | Live zone QR display (static or rotating TOTP with a 30 s countdown ring), mode toggle, secret rotation |
| **Enrollment** | The 4-step BYOD enrollment walkthrough, enrolled-device list, unenrollment (frees a device for re-registration) |
| **Users & Roles** | Manage console logins: create users, change roles, enable/disable, reset passwords, delete |
| **Settings** | Geofence polygon editor with live shape preview, device admin-password change, console API connection |

## Role-based access (from the database)

Access groups come from the backend's `users.role` column — the same roles
seeded by the server (`admin` / `manager1` / `viewer1`). The UI hides what a
role can't use **and** the server enforces the same matrix on every API call
(`requireRole` middleware), so the gating can't be bypassed from the browser.

| Capability | admin | manager | viewer |
|---|:-:|:-:|:-:|
| Overview / Devices / Metrics (read) | ✅ | ✅ | ✅ |
| Lock / unlock a device | ✅ | ✅ | — |
| Whitelists (global + per-device) | ✅ | ✅ | — |
| App policies & time limits | ✅ | ✅ | — |
| Geofence editing | ✅ | ✅ | — |
| QR display page | ✅ | ✅ | — |
| QR mode toggle + secret rotation | ✅ | — | — |
| Enrollment view | ✅ | ✅ | — |
| Unenroll (delete) a device | ✅ | — | — |
| Users & Roles management | ✅ | — | — |
| Device admin-password change | ✅ | — | — |

## Configuration

Edit **`assets/config.js`**:

```js
window.EG_CONFIG = {
  API_BASE: "https://YOUR-SERVER.onrender.com", // your deployed /server backend
  REFRESH_MS: 20000,
  COMPLIANT_AT: 80,
};
```

The API base can also be set at runtime from the login screen ("Server
connection") — handy for testing against staging without redeploying.

## Local preview

```bash
cd dashboard
npx serve .        # or: python3 -m http.server 8080
```

Then open http://localhost:8080 and point "Server connection" at your backend.

## Deploying

See **[DEPLOYMENT.md](DEPLOYMENT.md)** — step-by-step guides for free hosting
on Netlify, Vercel, GitHub Pages, Cloudflare Pages and Render, plus the CORS
notes for the backend.
