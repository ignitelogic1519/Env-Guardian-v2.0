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

> First complete cut. Easy next steps: a logo, testimonials, a pricing page,
> and swapping the mailto form for a hosted form service.
