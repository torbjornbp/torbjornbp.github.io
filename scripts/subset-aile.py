#!/usr/bin/env python3
"""Make the small Iosevka Aile webfonts in static/fonts.

Needs fonttools and brotli. Run from the repository root:

    python3 scripts/subset-aile.py <folder with the full Iosevka Aile .woff2 files>

The folder must hold IosevkaAile-Regular.woff2, -Bold.woff2 and -Italic.woff2
for VERSION. The current subsets were made from the files served by
https://typeof.net/Iosevka/. To keep more characters, add them to UNICODES
and run the script again.
"""
import sys
from pathlib import Path

from fontTools import subset

VERSION = "34.9.1"
STYLES = ["Regular", "Bold", "Italic"]

UNICODES = ",".join([
    "000D,0020-007E,00A0-00FF",  # Basic Latin, Latin-1
    "0100-017F",                 # Latin Extended-A
    "2010-2027,2032-2033,2039-203A",  # dashes, curly quotes, ellipsis, primes
    "20AC,2122",                 # euro, trademark
    "2080-2089",                 # subscript digits
    "2190-2193,21A9",            # arrows, footnote return arrow
    "2500-257F,2591-2593",       # box drawing, shades
    "25B2,25B6,25BC,25C0",       # triangles
    "263B,1F642",                # smileys
    "E0A0-E0A3,E0AE-E0BF",       # private-use symbols kept from the old subset
])

out_dir = Path(__file__).resolve().parent.parent / "static" / "fonts"
source_dir = Path(sys.argv[1])

for style in STYLES:
    options = subset.Options(flavor="woff2")
    options.name_IDs = ["*"]  # keep the name and licence entries
    font = subset.load_font(source_dir / f"IosevkaAile-{style}.woff2", options)
    found = font["name"].getDebugName(5)
    if not found.startswith(f"Version {VERSION};"):
        sys.exit(f"{style}: expected {VERSION}, found {found}")
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    out = out_dir / f"IosevkaAile-{style}-{VERSION}-subset.woff2"
    subset.save_font(font, out, options)
    print(f"{out.name}: {out.stat().st_size / 1000:.1f} kB")
