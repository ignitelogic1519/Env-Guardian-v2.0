# Env Guardian — Admin Console (`/dashboard`)

An online, role-based **admin dashboard** for the Env Guardian MDM system.
Pure static files (HTML + CSS + vanilla JS — no build step), designed to be
hosted on any free static host **separately from the backend**. It signs in
against the backend's `POST /api/auth/login` (JWT) and drives every admin
operation through the existing REST API.

The shield mark on the login screen is the product's brand logo — the same
artwork used by the marketing site's navbar and (since the branding pass) the
mobile app's launcher icon (vector source: `app/assets/logo/logo.svg`).

**Design:** two themes on one Intune-style shell (left navigation rail, top
bar, frosted content cards), switched with the **sun/moon toggle** in the top
bar (persisted per browser):

- **Dark (default):** glassmorphism + neumorphism over an animated aurora —
  matching the mobile app's Command Center.
- **Light:** the marketing website's language — white canvas, soft layered
  shadows, and the same pastel animated background blobs.

Both themes share the springy staggered reveals, count-up KPIs, hover-lift
cards and live pulse indicators; charts re-color themselves per theme
(palettes validated for contrast + color-blind safety on each surface).
Honours `prefers-reduced-motion`.

**Built for large fleets (1000+ devices):** every table paginates (devices
50/page; users, enrollment and compliance 25/page) with debounced search;
the Overview shows the ~24 devices needing attention first (locked →
non-compliant → in-zone) instead of rendering the whole fleet; the policy
device picker is a filtered list capped at 200 visible matches.

---

## Pages & features

| Page | What it does |
|------|--------------|
| **Home** | The landing page: a card per section explaining what it's for, what you can do there, and which roles can open it — plus live fleet mini-stats |
| **Overview** | KPI tiles (devices, online, in-zone, compliance rate, logins today) + the devices needing attention first; auto-refreshes every 20 s |
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
