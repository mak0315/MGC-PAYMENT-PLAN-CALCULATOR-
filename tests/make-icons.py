"""Generate the placeholder PWA icons (a plain faceted gem on the brand green).

These are NOT MGC's logo. To use the official logo, replace the PNGs in icons/
with the supplied artwork (same file names and sizes) and bump CACHE in sw.js.

Run: python3 tests/make-icons.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
INK = (11, 59, 52, 255)
INK2 = (20, 87, 74, 255)
BRASS = (200, 150, 40, 255)
LIGHT = (236, 241, 236, 255)
MID = (196, 214, 205, 255)


def gem(size, scale):
    """Draw the gem into a size x size canvas; `scale` is the share of the canvas it fills."""
    ss = 4  # supersample for smooth edges
    s = size * ss
    img = Image.new('RGBA', (s, s), INK)
    d = ImageDraw.Draw(img)
    w = s * scale
    cx, top = s / 2, s / 2 - w * 0.40
    left, right = cx - w / 2, cx + w / 2
    band = top + w * 0.30
    tip = top + w * 0.80
    # crown
    d.polygon([(left + w * 0.14, top), (right - w * 0.14, top), (right, band), (left, band)], fill=LIGHT)
    # pavilion
    d.polygon([(left, band), (right, band), (cx, tip)], fill=MID)
    # facets
    d.polygon([(left + w * 0.14, top), (cx, top), (cx - w * 0.22, band)], fill=BRASS)
    d.polygon([(cx, top), (right - w * 0.14, top), (cx + w * 0.22, band)], fill=(228, 190, 100, 255))
    d.polygon([(left, band), (cx - w * 0.22, band), (cx, tip)], fill=INK2)
    d.polygon([(cx + w * 0.22, band), (right, band), (cx, tip)], fill=(158, 190, 176, 255))
    return img.resize((size, size), Image.LANCZOS)


def save(name, size, scale):
    gem(size, scale).save(os.path.join(OUT, name))


os.makedirs(OUT, exist_ok=True)
save('icon-192.png', 192, 0.62)
save('icon-512.png', 512, 0.62)
save('icon-maskable-512.png', 512, 0.46)   # keeps the artwork inside the maskable safe zone
save('apple-touch-icon.png', 180, 0.62)
save('favicon-32.png', 32, 0.70)
print('icons written to', os.path.abspath(OUT))
