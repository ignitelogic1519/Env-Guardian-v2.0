#!/usr/bin/env python3
"""Regenerate every launcher/app icon from the Env Guardian shield logo.

The artwork matches the inline SVG used by the website navbar and the
admin-dashboard login screen (blue->teal gradient shield + white check),
set on a dark-navy glassmorphism tile: blurred colour glows behind a
translucent, stroked "glass" card with a diagonal sheen.

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
CHECK = "m21.2 29.8-5.4-5.4 2.5-2.5 2.9 2.9 8.5-8.5 2.5 2.5-11 11z"

DEFS = """
  <defs>
    <linearGradient id="eg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f6ef7"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.48" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
"""


def wrap(body: str) -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">{DEFS}{body}</svg>'


def group(scale: float, body: str) -> str:
    return f'<g transform="translate(24 24) scale({scale}) translate(-24 -24)">{body}</g>'


SHIELD = f'<path fill="url(#eg)" d="{SHIELD_OUTLINE}"/><path fill="#fff" d="{CHECK}"/>'


def render_svg(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def bg_layer(size: int) -> Image.Image:
    """Dark navy base with soft blurred colour glows (the light the glass refracts)."""
    svg = wrap(
        f'<rect width="48" height="48" fill="{BG}"/>'
        '<circle cx="11" cy="9" r="15" fill="#4f6ef7" fill-opacity="0.75"/>'
        '<circle cx="39" cy="41" r="17" fill="#14b8a6" fill-opacity="0.65"/>'
        '<circle cx="42" cy="8" r="10" fill="#7c5cff" fill-opacity="0.35"/>'
    )
    img = render_svg(svg, size)
    return img.filter(ImageFilter.GaussianBlur(radius=max(2, size * 0.10)))


def glass_fg(card_scale: float, shield_scale: float) -> str:
    """Translucent stroked card + shield + diagonal sheen (transparent background)."""
    c = 48 * card_scale
    x = (48 - c) / 2
    rx = c * 0.24
    sw = max(0.45, c * 0.022)
    card = f'x="{x:.2f}" y="{x:.2f}" width="{c:.2f}" height="{c:.2f}" rx="{rx:.2f}"'
    return wrap(
        f'<clipPath id="cardclip"><rect {card}/></clipPath>'
        f'<rect {card} fill="#ffffff" fill-opacity="0.12"/>'
        f'{group(shield_scale, SHIELD)}'
        f'<rect {card} fill="url(#sheen)" clip-path="url(#cardclip)"/>'
        f'<rect {card} fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="{sw:.2f}"/>'
    )


def icon(size: int, card_scale: float = 0.80, shield_scale: float = 0.56,
         opaque: bool = False) -> Image.Image:
    img = bg_layer(size)
    img.alpha_composite(render_svg(glass_fg(card_scale, shield_scale), size))
    return img.convert("RGB") if opaque else img


def favicon(size: int) -> Image.Image:
    """Bare shield on transparency, with the same sheen clipped to the shield."""
    svg = wrap(
        f'<clipPath id="sc"><path d="{SHIELD_OUTLINE}"/></clipPath>'
        f"{SHIELD}"
        f'<rect width="48" height="48" fill="url(#sheen)" clip-path="url(#sc)"/>'
    )
    return render_svg(svg, size)


def save(img: Image.Image, rel: str) -> None:
    path = APP / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"wrote {path.relative_to(APP)} ({img.size[0]}x{img.size[1]} {img.mode})")


def main() -> None:
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

    # Android legacy launcher icons (48dp) — full-bleed; launchers mask their own shape
    for density, mult in densities.items():
        save(icon(int(48 * mult)), f"android/app/src/main/res/mipmap-{density}/ic_launcher.png")

    # Android adaptive icon layers (108dp canvas, content inside the 66dp safe zone)
    for density, mult in densities.items():
        size = int(108 * mult)
        res = f"android/app/src/main/res/mipmap-{density}"
        save(bg_layer(size), f"{res}/ic_launcher_background.png")
        save(render_svg(glass_fg(0.52, 0.37), size), f"{res}/ic_launcher_foreground.png")

    # iOS (opaque, no alpha)
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
