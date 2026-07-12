# Deploying the Env Guardian Admin Console (free hosting)

The dashboard is a **static site** (no build step, no server code), so it can
be hosted for free on any static host, on a **different site/domain from the
backend**. The backend (the `/server` folder, on Render) already allows
cross-origin requests from `*.netlify.app`, `*.vercel.app` and
`*.onrender.com` out of the box.

> **TL;DR** — 1) edit `dashboard/assets/config.js` with your Render server URL,
> 2) push, 3) point a free static host at the `dashboard/` folder. Done.

---

## 0. Before you deploy (one-time)

1. **Backend up first.** Deploy `/server` to Render with `DATABASE_URL`,
   `JWT_SECRET`, `API_KEY`, `ADMIN_PASSWORD` set (see the root README). On
   first boot it creates all tables **and seeds the dashboard logins**:

   | username | default password | role |
   |---|---|---|
   | `admin` | value of `ADMIN_PASSWORD` | admin |
   | `manager1` | `Manager@2026` | manager |
   | `viewer1` | `Viewer@2026` | viewer |

   ⚠️ **Change the `manager1` / `viewer1` passwords immediately** after your
   first login (Users & Roles → Reset password).

2. **Point the dashboard at the backend.** Edit `dashboard/assets/config.js`:

   ```js
   API_BASE: "https://YOUR-SERVER.onrender.com",
   ```

   Commit and push. (Users can also override this per-browser from the login
   screen, but baking it in is what you want for production.)

---

## Option A — Netlify (recommended, ~2 minutes)

**Drag & drop (no account linking):**
1. Go to https://app.netlify.com/drop
2. Drag the local `dashboard/` folder onto the page.
3. Done — you get `https://<random-name>.netlify.app`. Rename it under
   *Site settings → Change site name*.

**From Git (auto-deploys on every push):**
1. Netlify → *Add new site → Import an existing project* → pick this repo.
2. Settings:
   - **Base directory:** `dashboard`
   - **Build command:** *(leave empty)*
   - **Publish directory:** `dashboard` (or `.` relative to base)
3. Deploy. Every push to the branch redeploys automatically.

CORS: nothing to do — the server already allows `*.netlify.app`.

## Option B — Vercel

1. https://vercel.com/new → import this repository.
2. **Root Directory:** `dashboard` · **Framework preset:** *Other* ·
   Build command: *(empty)* · Output directory: `.`
3. Deploy → `https://<project>.vercel.app`.

CORS: already allowed (`*.vercel.app`).

## Option C — GitHub Pages

1. Repo → *Settings → Pages* → Source: **GitHub Actions**, or serve the
   `dashboard/` folder from a branch:
   - Easiest: *Deploy from a branch* → branch `main`, folder `/docs` —
     then either rename `dashboard/` to `docs/`, **or** add a tiny workflow:

   ```yaml
   # .github/workflows/pages.yml
   name: Deploy dashboard to Pages
   on: { push: { branches: [main] } }
   permissions: { contents: read, pages: write, id-token: write }
   jobs:
     deploy:
       runs-on: ubuntu-latest
       environment: { name: github-pages }
       steps:
         - uses: actions/checkout@v4
         - uses: actions/upload-pages-artifact@v3
           with: { path: dashboard }
         - uses: actions/deploy-pages@v4
   ```

2. Site appears at `https://<user>.github.io/<repo>/`.
3. **CORS:** `github.io` is *not* in the server's default allow-list — add it
   on Render: *Environment* → `CORS_ORIGINS=https://<user>.github.io` (comma-
   separate if you have several origins), then redeploy the server.

## Option D — Cloudflare Pages

1. https://dash.cloudflare.com → *Workers & Pages → Create → Pages* → connect
   the repo.
2. Build command: *(none)* · Build output directory: `dashboard`.
3. **CORS:** add your `https://<project>.pages.dev` URL to the server's
   `CORS_ORIGINS` env var (as in Option C).

## Option E — Render Static Site (same account as the backend)

1. Render → *New → Static Site* → this repo.
2. **Root Directory:** `dashboard` · Build command: *(empty)* ·
   Publish directory: `.`
3. `https://<name>.onrender.com` — CORS already allowed.

---

## Post-deploy checklist

- [ ] Open the site → the animated login screen loads.
- [ ] Sign in as `admin` — all 9 pages appear in the left rail.
- [ ] Sign in as `viewer1` — only Home / Overview / Devices / Metrics appear, and
      no action buttons render.
- [ ] Metrics page shows the login chart (your own sign-ins already count).
- [ ] QR Settings renders the code (the QR library loads from jsDelivr; if a
      corporate network blocks CDNs the code value is still shown as text).
- [ ] Changed the seeded `manager1`/`viewer1` passwords.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login says *"Cannot reach server"* | `API_BASE` in `assets/config.js` is wrong, or the Render free instance is cold-starting (first request takes ~30 s — retry). |
| Browser console shows a **CORS** error | Your host's domain isn't allowed. Add it to the server's `CORS_ORIGINS` env var on Render and redeploy. Netlify/Vercel/Render subdomains are pre-allowed. |
| Login works but pages show *Forbidden* | The account's role doesn't permit that page/action — check Users & Roles as an admin. |
| *"Session expired"* | JWTs last 8 h; sign in again. |
| Metrics "logins" chart is empty | The `login_events` table fills as people sign in after this update — give it a day. |

## Security notes

- The dashboard holds **no secrets** — it's safe on a public static host. Auth
  is a short-lived JWT kept in `sessionStorage` (cleared when the tab closes).
- Role checks run **server-side** (`requireRole`); the UI merely mirrors them.
- Never put the device `API_KEY` in this dashboard or its config — the console
  authenticates with user JWTs only.
