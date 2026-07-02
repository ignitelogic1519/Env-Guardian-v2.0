# Env Guardian — Marketing Website

A complete, multi-page, animated product site (light theme, glassmorphism,
animate-on-scroll, responsive) with the mascot **Aegis** and real app screenshots.

## Pages
| File | Purpose |
|------|---------|
| `index.html` | Home — hero, mascot, stats, problem, feature + industry teasers |
| `features.html` | Every capability, with screenshots |
| `solutions.html` | Benefits by industry + persona characters |
| `how-it-works.html` | The 4-step flow, with real app screens |
| `contact.html` | Demo request form + FAQ |

Shared assets live in `assets/` (`style.css`, `main.js`, `shots/` screenshots).

## View it
- **Locally:** open `index.html` in a browser (double-click). Everything is
  relative-path, so navigation between pages works offline. Fonts load from
  Google Fonts (needs internet); without it, it falls back to system fonts.

## Deploy (free, ~2 min) — publish the `website/` folder
- **Netlify:** drag the `website/` folder onto <https://app.netlify.com/drop>.
- **Vercel:** import the repo, set the project root to `website`.
- **GitHub Pages:** serve the `website/` folder (or copy it to a `docs/` folder / `gh-pages` branch).
- **Render:** New → Static Site → publish directory `website`.

## Customize
- **Colors:** CSS variables at the top of `assets/style.css` (`--accent`, `--accent2`, backgrounds).
- **Copy:** plain HTML in each page — edit text directly.
- **Contact:** the form uses a `mailto:` to `ignite.logic1519@gmail.com`. For a real
  inbox-free submission, swap the `<form action>` to a Formspree/Getform endpoint.
- **Screenshots:** in `assets/shots/` — replace with newer captures anytime (keep names).

## Aegis chatbot — make it a real AI (LLM)
The floating **Aegis** bot works out of the box using a built-in FAQ brain. To turn it
into a **real LLM assistant** (Claude):
1. On the backend (Render) set env vars: `LLM_API_KEY` = your Anthropic API key,
   optionally `LLM_MODEL` (default `claude-haiku-4-5-20251001`). Redeploy.
2. Allow the site to call the API: add your site's domain to `CORS_ORIGINS`
   (sites on `*.netlify.app` / `*.vercel.app` / `*.onrender.com` are already allowed).
3. That's it — the widget calls `POST /api/aegis/chat` on the server, which proxies
   to the LLM with the key kept server-side. If the key is missing or the call fails,
   it automatically falls back to the FAQ brain, so it never breaks.
- Point the widget at a different API host by setting `window.AEGIS_API` before
  `aegis-bot.js` loads. Guardrails (no secrets, on-topic only) live in the server
  system prompt **and** a client-side pre-check.

> First complete cut. Easy next steps: a logo, testimonials, a pricing page,
> and swapping the mailto form for a hosted form service.
