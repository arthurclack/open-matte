#!/usr/bin/env python3
"""Cut the site's fonts down to what the pages and the scenes draw, as WOFF2.

    python3 site/tools/fonts.py [SOURCE]

SOURCE is the folder with the app's own font files (default: web/public/fonts
in this repository). The results go to site/public/fonts, beside each font's
licence. It needs fontTools and brotli:

    python3 -m venv /tmp/fonttools && /tmp/fonttools/bin/pip install fonttools brotli

Each font keeps the Latin characters only, and only the weights and settings
the stylesheets ask for. The page's four (src/tokens.css):

- Libre Franklin: the variable font, weights 400 to 700.
- Fraunces: one fixed style, weight 800, opsz 72, SOFT 100, WONK 0, the
  wordmark's and the poster's.
- IBM Plex Mono Regular, renamed Matte Mono. Its licence reserves the name
  "Plex", and a cut-down copy is a modified version, so it can't keep it.
- Courier Prime Regular.

And two that only the scenes of the app set (src/stage/look.css, loaded
with a scene, never with the page):

- IBM Plex Mono SemiBold, renamed Matte Mono like the Regular: the machine's
  heavier words (the app asks for 500 and 600 from this one file). It also
  keeps the left arrow (U+2190), for the back office's "← Films".
- VT323 Regular: the blue screen's lettering (the PLAY tile, the counter).

VT323's licence reserves no name, so it keeps its own. The staff pick's hand,
Grape Nuts, is never set as text: the pick is a picture baked from the app.

Two runs give byte-identical files.
"""

import io
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SITE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else SITE.parent / "web" / "public" / "fonts"
OUT = SITE / "public" / "fonts"

# Basic Latin and Latin-1, typographic punctuation and spaces, the euro, the
# trade mark and the few signs Western text uses (Google Fonts' "latin" range).
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
    "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,"
    "U+FEFF,U+FFFD"
)


def reload(font):
    """The instancer leaves some tables half-read; the subsetter needs them whole."""
    buffer = io.BytesIO()
    font.recalcTimestamp = False
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer, recalcTimestamp=False)


def cut(font, out, extra=""):
    """Cut a font to LATIN (and any EXTRA characters, as a unicode range string) and write it as WOFF2."""
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features += ["tnum", "lnum", "pnum", "onum"]
    options.name_IDs = ["*"]  # keep the copyright, licence and licence URL
    options.notdef_outline = True
    options.drop_tables += ["meta"]  # Libre Franklin's language tags, which the subsetter can't cut
    sub = subset.Subsetter(options)
    sub.populate(unicodes=subset.parse_unicodes(LATIN + ("," + extra if extra else "")))
    sub.subset(font)
    font.flavor = "woff2"
    font.recalcTimestamp = False  # keep the source's date, so two runs match
    font.save(OUT / out)
    print(f"{out}: {(OUT / out).stat().st_size:,} bytes")


def rename_plex(font):
    """IBM Plex Mono becomes Matte Mono in every name a system or browser shows."""
    name = font["name"]
    for record in name.names:
        text = record.toUnicode()
        if record.nameID in (1, 3, 4, 6, 16, 17, 18, 21, 22, 25):
            text = text.replace("IBM Plex Mono", "Matte Mono").replace("IBMPlexMono", "MatteMono")
            if "Plex" in text:
                raise SystemExit(f"name {record.nameID} still says Plex: {text!r}")
            name.setName(text, record.nameID, record.platformID, record.platEncID, record.langID)
    name.setName(
        "Matte Mono is a Latin subset of IBM Plex Mono (github.com/IBM/plex), renamed as "
        "the SIL Open Font License asks of a modified version with a Reserved Font Name.",
        10, 3, 1, 0x409,
    )


def main():
    if not SOURCE.is_dir():
        raise SystemExit(f"no font folder at {SOURCE}; pass the app's web/public/fonts")

    franklin = TTFont(SOURCE / "LibreFranklin-Variable.ttf", recalcTimestamp=False)
    franklin = instancer.instantiateVariableFont(franklin, {"wght": (400, 700)})
    cut(reload(franklin), "LibreFranklin-400-700.woff2")

    fraunces = TTFont(SOURCE / "Fraunces-Variable.ttf", recalcTimestamp=False)
    fraunces = instancer.instantiateVariableFont(
        fraunces, {"wght": 800, "opsz": 72, "SOFT": 100, "WONK": 0}
    )
    cut(reload(fraunces), "Fraunces-800.woff2")

    plex = TTFont(SOURCE / "IBMPlexMono-Regular.ttf", recalcTimestamp=False)
    rename_plex(plex)
    cut(plex, "MatteMono-Regular.woff2")

    cut(TTFont(SOURCE / "CourierPrime-Regular.ttf", recalcTimestamp=False), "CourierPrime-Regular.woff2")

    # the scenes' faces. The SemiBold also keeps the left arrow: the back
    # office's "← Films" sets it at 500 (the page's four stay Latin only)
    plex_semibold = TTFont(SOURCE / "IBMPlexMono-SemiBold.ttf", recalcTimestamp=False)
    rename_plex(plex_semibold)
    cut(plex_semibold, "MatteMono-SemiBold.woff2", extra="U+2190")

    cut(TTFont(SOURCE / "VT323-Regular.ttf", recalcTimestamp=False), "VT323-Regular.woff2")


if __name__ == "__main__":
    main()
