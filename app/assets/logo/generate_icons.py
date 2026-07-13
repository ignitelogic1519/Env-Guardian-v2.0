#!/usr/bin/env python3
"""Regenerate every launcher/app icon from the Env Guardian shield logo.

The artwork matches the inline SVG used by the website navbar and the
admin-dashboard login screen (blue->teal gradient shield + white check),
set on a dark-navy glassmorphism tile: blurred colour glows behind a
translucent, stroked "glass" card with a diagonal sheen.

Besides the default brand icon, this also emits the five Android
DYNAMIC-ICON state variants (see DynamicIconManager.kt / the
activity-aliases in AndroidManifest.xml): onsite, safe, attention,
alert and paused. Android is the only platform that supports silent
state-driven icon switching — iOS shows a system alert on every icon
change, so the iOS icon stays static.

Usage:  pip install pillow cairosvg && python3 generate_icons.py
Run from anywhere; paths are resolved relative to this file (app/assets/logo/).
"""

import io
from pathlib import Path

import cairosvg
from PIL import Image, ImageFilter

APP = Path(__file__).resolve().parents[2]  # .../app

BG = "#0a0e1c"  # dashboard --bg0 (dark navy)

SHIELD_OUTLINE = "M24 3 6 10v13c0 11.5 7.7 19.4 18 22 10.3-2.6 18-10.5 18-22V10L24 3z"

# Glyphs drawn inside the shield (48-viewbox coords, shield centre ~ (24, 23)).
# Every state gets a distinct GLYPH, not just a colour, so the states stay
# distinguishable for colour-blind users and at 48 px.
CHECK = '<path fill="#fff" d="m21.2 29.8-5.4-5.4 2.5-2.5 2.9 2.9 8.5-8.5 2.5 2.5-11 11z"/>'
CROSS = ('<path fill="#fff" d="M24 20.6l4.2-4.2 2.4 2.4-4.2 4.2 4.2 4.2-2.4 2.4-4.2-4.2'
         '-4.2 4.2-2.4-2.4 4.2-4.2-4.2-4.2 2.4-2.4z"/>')
PIN = ('<path fill="#fff" fill-rule="evenodd" d="M24 13c-4.4 0-8 3.6-8 8 0 5.8 8 13.5 8 13.5'
       's8-7.7 8-13.5c0-4.4-3.6-8-8-8zm0 11.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"/>')
BANG = ('<rect x="22.3" y="14.5" width="3.4" height="11.6" rx="1.7" fill="#fff"/>'
        '<circle cx="24" cy="31" r="2.3" fill="#fff"/>')
PAUSE = ('<rect x="19.6" y="17" width="3.1" height="12.5" rx="1.5" fill="#fff"/>'
         '<rect x="25.3" y="17" width="3.1" height="12.5" rx="1.5" fill="#fff"/>')

BRAND_GRAD = ("#4f6ef7", "#14b8a6")
BRAND_GLOWS = ("#4f6ef7", "#14b8a6", "#7c5cff")

# state name -> (gradient stops, glyph, glow colours). Names are shared with
# DynamicIconManager.kt, the activity-aliases and background_service.dart.
STATES = {
    "onsite": (BRAND_GRAD, PIN, BRAND_GLOWS),
    "safe": (("#34d399", "#059669"), CHECK, ("#34d399", "#0ea5e9", "#14b8a6")),
    "attention": (("#fbbf24", "#d97706"), BANG, ("#fbbf24", "#f97316", "#f59e0b")),
    "alert": (("#f87171", "#b91c1c"), CROSS, ("#f87171", "#f43f5e", "#ef4444")),
    "paused": (("#94a3b8", "#475569"), PAUSE, ("#94a3b8", "#64748b", "#475569")),
}

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def defs(grad) -> str:
    return f"""
  <defs>
    <linearGradient id="eg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{grad[0]}"/>
      <stop offset="1" stop-color="{grad[1]}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.48" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
"""


def wrap(body: str, grad=BRAND_GRAD) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
            f"{defs(grad)}{body}</svg>")


def group(scale: float, body: str) -> str:
    return f'<g transform="translate(24 24) scale({scale}) translate(-24 -24)">{body}</g>'


def shield(glyph: str = CHECK) -> str:
    return f'<path fill="url(#eg)" d="{SHIELD_OUTLINE}"/>{glyph}'


def render_svg(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def bg_layer(size: int, glows=BRAND_GLOWS) -> Image.Image:
    """Dark navy base with soft blurred colour glows (the light the glass refracts)."""
    svg = wrap(
        f'<rect width="48" height="48" fill="{BG}"/>'
        f'<circle cx="11" cy="9" r="15" fill="{glows[0]}" fill-opacity="0.75"/>'
        f'<circle cx="39" cy="41" r="17" fill="{glows[1]}" fill-opacity="0.65"/>'
        f'<circle cx="42" cy="8" r="10" fill="{glows[2]}" fill-opacity="0.35"/>'
    )
    img = render_svg(svg, size)
    return img.filter(ImageFilter.GaussianBlur(radius=max(2, size * 0.10)))


def glass_fg(card_scale: float, shield_scale: float, glyph=CHECK, grad=BRAND_GRAD) -> str:
    """Translucent stroked card + shield + diagonal sheen (transparent background)."""
    c = 48 * card_scale
    x = (48 - c) / 2
    rx = c * 0.24
    sw = max(0.45, c * 0.022)
    card = f'x="{x:.2f}" y="{x:.2f}" width="{c:.2f}" height="{c:.2f}" rx="{rx:.2f}"'
    return wrap(
        f'<clipPath id="cardclip"><rect {card}/></clipPath>'
        f'<rect {card} fill="#ffffff" fill-opacity="0.12"/>'
        f'{group(shield_scale, shield(glyph))}'
        f'<rect {card} fill="url(#sheen)" clip-path="url(#cardclip)"/>'
        f'<rect {card} fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="{sw:.2f}"/>',
        grad,
    )


def icon(size: int, card_scale: float = 0.80, shield_scale: float = 0.56,
         opaque: bool = False, glyph=CHECK, grad=BRAND_GRAD, glows=BRAND_GLOWS) -> Image.Image:
    img = bg_layer(size, glows)
    img.alpha_composite(render_svg(glass_fg(card_scale, shield_scale, glyph, grad), size))
    return img.convert("RGB") if opaque else img


def favicon(size: int) -> Image.Image:
    """Bare shield on transparency, with the same sheen clipped to the shield."""
    svg = wrap(
        f'<clipPath id="sc"><path d="{SHIELD_OUTLINE}"/></clipPath>'
        f"{shield()}"
        f'<rect width="48" height="48" fill="url(#sheen)" clip-path="url(#sc)"/>'
    )
    return render_svg(svg, size)


def save(img: Image.Image, rel: str) -> None:
    path = APP / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"wrote {path.relative_to(APP)} ({img.size[0]}x{img.size[1]} {img.mode})")


def save_text(text: str, rel: str) -> None:
    path = APP / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(f"wrote {path.relative_to(APP)}")


def adaptive_xml(suffix: str) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher{suffix}_background" />
    <foreground android:drawable="@mipmap/ic_launcher{suffix}_foreground" />
</adaptive-icon>
"""


def android_icon_set(suffix: str, glyph, grad, glows) -> None:
    """One complete Android launcher-icon set: legacy PNGs (48dp), adaptive
    background/foreground layers (108dp canvas, content in the 66dp safe zone)
    and the anydpi-v26 adaptive-icon XML."""
    for density, mult in DENSITIES.items():
        res = f"android/app/src/main/res/mipmap-{density}"
        save(icon(int(48 * mult), glyph=glyph, grad=grad, glows=glows),
             f"{res}/ic_launcher{suffix}.png")
        size = int(108 * mult)
        save(bg_layer(size, glows), f"{res}/ic_launcher{suffix}_background.png")
        save(render_svg(glass_fg(0.52, 0.37, glyph, grad), size),
             f"{res}/ic_launcher{suffix}_foreground.png")
    save_text(adaptive_xml(suffix),
              f"android/app/src/main/res/mipmap-anydpi-v26/ic_launcher{suffix}.xml")


def main() -> None:
    # Default brand icon (pre-enrollment / fallback alias)
    android_icon_set("", CHECK, BRAND_GRAD, BRAND_GLOWS)

    # Dynamic-icon state variants (Android only)
    for state, (grad, glyph, glows) in STATES.items():
        android_icon_set(f"_{state}", glyph, grad, glows)

    # iOS (opaque, no alpha) — static brand icon; see module docstring
    ios_sizes = {
        "Icon-App-20x20@1x.png": 20, "Icon-App-20x20@2x.png": 40, "Icon-App-20x20@3x.png": 60,
        "Icon-App-29x29@1x.png": 29, "Icon-App-29x29@2x.png": 58, "Icon-App-29x29@3x.png": 87,
        "Icon-App-40x40@1x.png": 40, "Icon-App-40x40@2x.png": 80, "Icon-App-40x40@3x.png": 120,
        "Icon-App-60x60@2x.png": 120, "Icon-App-60x60@3x.png": 180,
        "Icon-App-76x76@1x.png": 76, "Icon-App-76x76@2x.png": 152,
        "Icon-App-83.5x83.5@2x.png": 167, "Icon-App-1024x1024@1x.png": 1024,
    }
    for name, size in ios_sizes.items():
        save(icon(size, opaque=True), f"ios/Runner/Assets.xcassets/AppIcon.appiconset/{name}")

    # macOS
    for size in (16, 32, 64, 128, 256, 512, 1024):
        save(icon(size), f"macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_{size}.png")

    # Windows multi-resolution .ico
    path = APP / "windows/runner/resources/app_icon.ico"
    icon(256).save(path, format="ICO", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print(f"wrote {path.relative_to(APP)} (multi-size ICO)")

    # Web: favicon is the bare shield on transparency; PWA icons are full-bleed,
    # maskable ones keep the glass card inside the 80% safe zone.
    save(favicon(32), "web/favicon.png")
    for size in (192, 512):
        save(icon(size), f"web/icons/Icon-{size}.png")
        save(icon(size, card_scale=0.62, shield_scale=0.44), f"web/icons/Icon-maskable-{size}.png")


if __name__ == "__main__":
    main()
