#!/usr/bin/env python3
"""Regenerate every launcher/app icon from the Env Guardian shield logo.

The artwork matches the inline SVG used by the website navbar and the
admin-dashboard login screen (blue->teal gradient shield + white check).

Usage:  pip install pillow cairosvg && python3 generate_icons.py
Run from anywhere; paths are resolved relative to this file (app/assets/logo/).
"""

import io
from pathlib import Path

import cairosvg
from PIL import Image

APP = Path(__file__).resolve().parents[2]  # .../app

BG = "#0a0e1c"  # dashboard --bg0 (dark navy)

SHIELD = """
    <path fill="url(#eg)" d="M24 3 6 10v13c0 11.5 7.7 19.4 18 22 10.3-2.6 18-10.5 18-22V10L24 3z"/>
    <path fill="#fff" d="m21.2 29.8-5.4-5.4 2.5-2.5 2.9 2.9 8.5-8.5 2.5 2.5-11 11z"/>
"""


def make_svg(scale: float, bg: str | None) -> str:
    rect = f'<rect width="48" height="48" fill="{bg}"/>' if bg else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="eg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f6ef7"/>
      <stop offset="1" stop-color="#14b8a6"/>
    </linearGradient>
  </defs>
  {rect}
  <g transform="translate(24 24) scale({scale}) translate(-24 -24)">{SHIELD}</g>
</svg>"""


def render(size: int, scale: float = 0.72, bg: str | None = BG, opaque: bool = False) -> Image.Image:
    png = cairosvg.svg2png(
        bytestring=make_svg(scale, bg).encode(), output_width=size, output_height=size
    )
    img = Image.open(io.BytesIO(png))
    if opaque and img.mode == "RGBA":  # iOS App Store icons must not contain alpha
        flat = Image.new("RGB", img.size, BG)
        flat.paste(img, mask=img.split()[3])
        return flat
    if opaque:
        return img.convert("RGB")
    return img


def save(img: Image.Image, rel: str) -> None:
    path = APP / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"wrote {path.relative_to(APP)} ({img.size[0]}x{img.size[1]} {img.mode})")


def main() -> None:
    # Android launcher icons
    for density, size in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        save(render(size), f"android/app/src/main/res/mipmap-{density}/ic_launcher.png")

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
        save(render(size, opaque=True), f"ios/Runner/Assets.xcassets/AppIcon.appiconset/{name}")

    # macOS
    for size in (16, 32, 64, 128, 256, 512, 1024):
        save(render(size), f"macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_{size}.png")

    # Windows multi-resolution .ico
    ico = render(256)
    path = APP / "windows/runner/resources/app_icon.ico"
    ico.save(path, format="ICO", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print(f"wrote {path.relative_to(APP)} (multi-size ICO)")

    # Web: favicon is the bare shield on transparency; PWA icons are full-bleed,
    # maskable ones keep the shield inside the 80% safe zone.
    save(render(32, scale=1.0, bg=None), "web/favicon.png")
    for size in (192, 512):
        save(render(size), f"web/icons/Icon-{size}.png")
        save(render(size, scale=0.55), f"web/icons/Icon-maskable-{size}.png")


if __name__ == "__main__":
    main()
