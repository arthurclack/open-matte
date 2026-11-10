# Import format (schema version 1)

This is the contract between your encoding workflow and Open Matte. You prepare a
film folder on your own computer, copy it into the server's media directory
([adding films](deploying.md#adding-films)), and press **Scan media folder** in the
admin. The server never encodes anything.

## Folder layout

```text
/media/
  arrival/                 ← the folder name is the URL: your-domain/arrival
    film.json              ← strongly recommended (see below)
    poster.jpg
    backdrop.jpg
    hls/
      master.m3u8          ← master playlist, listing every rendition
      v_hevc_2160_hdr/…    ← renditions, in any layout you like
      v_h264_1080/…
      a_en_0/…
    subtitles/
      en.vtt
```

Folder names must be lowercase letters, digits and hyphens, at most 64 of them,
starting and ending with a letter or digit. A few names are reserved for the site
itself (`admin`, `api`, `media`, `t`, `assets`, …). A film folder must be a real
folder: the scan skips a symlink in its place, and says so.

A folder with neither `film.json` nor `hls/master.m3u8` isn't a film. The scan lists
it as skipped and leaves it alone, so you can keep other things in the media folder.

The server matches file names exactly, letter case and accents included, so
`Poster.JPG` is not `poster.jpg`. A Mac's disk ignores the difference, so a scan
there warns about a name that only matches loosely. Lowercase names without
accents (`poster.jpg`, `subtitles/en.vtt`) avoid the question.

## film.json

```json
{
  "schemaVersion": 1,
  "slug": "arrival",
  "title": "Arrival",
  "originalTitle": null,
  "year": 2016,
  "runtimeMinutes": 116,
  "directors": ["Denis Villeneuve"],
  "country": "United States",
  "synopsis": "Film description.",
  "recommendation": "Your personal recommendation.",
  "contentNote": null,
  "tmdbId": 329865,
  "poster": "poster.jpg",
  "backdrop": "backdrop.jpg",
  "hls": "hls/master.m3u8",
  "subtitles": [
    { "language": "en", "label": "English", "file": "subtitles/en.vtt" },
    { "language": "en", "label": "English (SDH)", "file": "subtitles/en.sdh.vtt" },
    { "language": "fr", "label": "French (forced)", "file": "subtitles/fr.forced.vtt", "forced": true }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | yes | Must be `1`. |
| `slug` | no | If given, must match the folder name. |
| `title` | yes | |
| `hls` | yes | Path to the master playlist. |
| `year`, `runtimeMinutes` | no | Whole numbers. Runtime defaults to the playlist's length. |
| `directors` | no | Text, or a list of names. |
| `originalTitle`, `country`, `synopsis`, `recommendation`, `contentNote` | no | Text. |
| `poster`, `backdrop` | no | `.jpg`, `.png`, `.webp` or `.avif`. A poster is strongly recommended. |
| `subtitles` | no | `language` is a code such as `en` or `pt-BR`; `label` defaults to the language's name; `file` must be WebVTT. `forced` and `default` are optional booleans. |
| `tmdbId` | no | The film's number on TMDB (from its address, such as `themoviedb.org/movie/329865`). Pins the match when [film information](metadata.md) is turned on. Added later, it settles a film marked **Choose a TMDB match** at the next scan. |

Every path is relative to the film folder and must stay inside it.

Without a `film.json`, a folder with `hls/master.m3u8` still imports, with a
warning, so you can preview a folder fresh from the encoder. The title comes from
the folder name, and the standard layout above is used: `poster.jpg`,
`backdrop.jpg` and `subtitles/<language>.vtt`. Write a `film.json` before you
put it on the shelf.

With [film information from TMDB](metadata.md) turned on, a minimal `film.json`
is enough: `schemaVersion`, `title` (a year helps), `hls` and your
`recommendation` (the staff pick, on the film's page). The rest, and the artwork, can come from TMDB.

## What a scan checks

Scans run in the background, in a separate thread, so a slow network drive never
holds up playback. The server scans once when it starts, after it's already
serving, and whenever you press **Scan media folder**. If the media folder is
missing, unreadable, or empty while films are listed (storage that isn't mounted,
say), the scan reports that and changes nothing, rather than marking every film
missing.

**Errors** stop a film from going on the shelf (and make one on the shelf unavailable):

- `film.json` not valid JSON, wrong `schemaVersion`, invalid fields, or a `slug` that doesn't match the folder
- a film's folder left with neither `film.json` nor `hls/master.m3u8`
- any declared file missing or outside the folder
- the master playlist missing, or not a master playlist
- any rendition or audio playlist missing, incomplete (no `#EXT-X-ENDLIST`), or with missing segments or init segments. A half-finished `rsync` shows up here
- a rendition that refers to an audio group the master playlist doesn't define

**Warnings** are worth fixing but don't block anything:

- no `film.json` (the folder name becomes the title)
- a declared file whose name only matches if letter case or accents are ignored, on a disk that ignores them
- no poster
- a rendition without a `CODECS` attribute
- HEVC tagged `hev1` rather than `hvc1`, or HEVC/AV1 in MPEG-TS rather than fMP4
- no H.264 SDR rendition (see below)
- only HDR renditions
- no audio rendition marked `DEFAULT=YES`
- `.vtt` files in the folder that `film.json` doesn't list
- unknown fields in `film.json` (usually a typo)

## Codecs

HEVC support depends on the browser, operating system, hardware decoder and
exact encoding, so don't rely on browser names. Always provide a genuine H.264
SDR fallback rendition, give every rendition a correct `CODECS` attribute so
players can skip what they can't decode, use fMP4 (CMAF) segments, and test
playback on the devices your friends actually use.

## Rescans and your edits

The first scan imports `film.json` into the database. After that the back office owns
the metadata. Each later scan compares field by field:

- a field you haven't edited follows `film.json`
- a field you have edited is kept. If `film.json` changed it too, the scan that
  first sees the change reports the conflict, once: in the scan report if you
  pressed **Scan media folder**, or in the server log if it was the scan at
  startup. The film's page still marks the field "edited here", and **Reset to
  film.json** takes the file's version of every field you edited (what TMDB
  filled in stays as it is)

Media (playlists, artwork, subtitles) always follows the folder. New films are
always off the shelf. A film whose folder disappears is marked missing, not deleted.

Don't rename a film's folder once tapes are out. Tapes belong to the film,
not its address, but a renamed folder imports as a new film, off the shelf, and the
old one (with its tapes) is marked missing. Renaming it back restores it, and
leaves the film created under the new name behind, marked missing.

Symlinks inside a film folder are fine if they point to something in the same
folder. The server never serves a file that really lives anywhere else, and the
scan reports a listed file, playlist or segment folder that does.

A value TMDB filled in counts as the file's, not yours: if you later add that
field to `film.json`, the file's value replaces it. See [metadata.md](metadata.md).
