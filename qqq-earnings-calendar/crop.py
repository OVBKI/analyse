#!/usr/bin/env python3
"""Recadre le screenshot brut au contenu (retire le fond uni #04060a)."""
import sys
from PIL import Image, ImageChops

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
bg = Image.new("RGB", im.size, (4, 6, 10))  # body background #04060a
bbox = ImageChops.difference(im, bg).getbbox()
if bbox:
    im = im.crop(bbox)
im.save(out)
print(f"crop -> {im.size[0]}x{im.size[1]}")
