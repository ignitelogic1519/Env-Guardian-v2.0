# Env Guardian — Marketing Website

A single-file animated landing page that explains and sells the product
(glassmorphism, moving aurora background, animated hero, scroll-reveal).

## View it
- **Locally:** just open `index.html` in any browser (double-click it). No build,
  no server needed. Fonts + nothing else load from the internet.

## Deploy it (free, ~2 min)
Any static host works — the whole site is one file:
- **Netlify:** drag the `website/` folder onto <https://app.netlify.com/drop>.
- **Vercel:** `vercel` in this folder, or import the repo and set root = `website`.
- **GitHub Pages:** enable Pages and point it at this folder / a `gh-pages` branch.
- **Render:** New → Static Site → publish directory `website`.

## Editing
Everything (HTML + CSS + JS) is inline in `index.html`:
- Copy/sections are plain HTML — edit the text directly.
- Colours are CSS variables at the top (`--accent`, `--accent2`, backgrounds).
- The demo email link points to `ignite.logic1519@gmail.com` — change as needed.

> This is a first/rough marketing cut. Next steps could be: real screenshots,
> a logo, a testimonials section, and a proper contact form.
