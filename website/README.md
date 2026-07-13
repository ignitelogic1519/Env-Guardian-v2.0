# Env Guardian — Marketing Website

A complete, multi-page, animated product site — **light, professional SaaS look**
(inspired by flowty.co): white canvas, bold display type, soft-shadow cards,
springy staggered scroll reveals, an industry marquee strip, floating phone
mockups with pointer tilt, and real app screenshots. Fully responsive (built
mobile-first for Android-sized screens) and respects `prefers-reduced-motion`.

> The floating AI chat widget (Aegis) has been **removed entirely** from the
> site. The backend's `/api/aegis/chat` proxy still exists server-side but is
> dormant/unused by these pages.

## Pages
| File | Purpose |
|------|---------|
| `index.html` | Home — hero (line-mask headline animation), industry marquee, stats, problem, feature + industry teasers |
| `features.html` | Every capability, with screenshots |
| `solutions.html` | Benefits by industry + persona characters |
| `how-it-works.html` | The 4-step flow, with real app screens |
| `contact.html` | Demo request form + FAQ |

Shared assets live in `assets/` (`style.css`, `main.js`, `shots/` screenshots).

## Animations (all CSS/vanilla JS — no libraries)
- **Animate-on-scroll with REWIND** — reveals play forward on enter and *reverse*
  when you scroll back up (the IntersectionObserver keeps observing and toggles the
  `vis` class both ways). Add `class="reveal"` plus an optional variant:
  `left`, `right`, `zoom`, `pop`, `blur`, `flip`, `tiltin`. Stagger is computed
  per **section** (via the `--d` CSS var) so each block cascades on its own.
- **Scroll-scrubbed transforms** — continuous motion tied to scroll position (and
  reversing naturally on scroll-up). Add `data-scrub="rise|fall|left|right|zoom|
  rotate|fade"` with optional `data-scrub-amt="70"` to any element (used on the
  phone mockups for parallax).
- **Headline line-mask reveal** on load (hero `h1` lines slide up out of a clip).
- **Industry marquee** — an infinite, edge-masked scrolling strip (pauses on hover).
- **Pointer tilt** on the hero phone stack (desktop only), plus a gentle float.
- **Hover-lift cards**, animated stat **counters**, background blob **parallax**,
  nav solidify-on-scroll, scroll progress bar.
- Everything is disabled under `prefers-reduced-motion` (content shown, counters
  filled to final value).

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
- **Marquee items:** edit the `.m-item` spans in `index.html` (the list is duplicated
  once for the seamless loop — keep both copies in sync).

> The shield logo in the navbar is the product's brand mark — the same artwork
> now used as the mobile app's launcher icon and the admin console's login logo
> (vector source: `app/assets/logo/logo.svg`).
>
> Easy next steps: testimonials, a pricing page, and swapping the mailto form
> for a hosted form service.
