# Import format (schema version 1)

This is the contract between your encoding workflow and Open Matte. You prepare a
film folder on your own computer, copy it into the server's media directory, and
press **Scan media folder** in the admin. The server never encodes anything.

## Folder layout

```text
/media/
  arrival/                 ← the folder name is the URL: your-domain/arrival
    film.json              ← required
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

Folder names must be lowercase letters, digits and hyphens. A few names are
reserved for the site itself (`admin`, `api`, `media`, `t`, `assets`, …).

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
| `tmdbId` | no | The film's number on TMDB (from its address, such as `themoviedb.org/movie/329865`). Pins the match when [film information](metadata.md) is turned on. |

Every path is relative to the film folder and must stay inside it.

With [film information from TMDB](metadata.md) turned on, a minimal `film.json`
is enough: `schemaVersion`, `title` (a year helps), `hls` and your
`recommendation`. The rest, and the artwork, can come from TMDB.

## What a scan checks

Scans run in the background, in a separate thread, so a slow network drive never
holds up playback. The server scans once when it starts, after it's already
serving, and whenever you press **Scan media folder**. If the media folder is
missing, unreadable, or empty while films are listed (storage that isn't mounted,
say), the scan reports that and changes nothing, rather than marking every film
missing.

**Errors** stop a film from being published (and make a published one unavailable):

- `film.json` missing, not valid JSON, wrong `schemaVersion`, invalid fields, or a `slug` that doesn't match the folder
- any declared file missing or outside the folder
- the master playlist missing, or not a master playlist
- any rendition or audio playlist missing, incomplete (no `#EXT-X-ENDLIST`), or with missing segments or init segments. A half-finished `rsync` shows up here
- a rendition that refers to an audio group the master playlist doesn't define

**Warnings** are worth fixing but don't block anything:

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

The first scan imports `film.json` into the database. After that the admin owns
the metadata. Each later scan compares field by field:

- a field you haven't edited follows `film.json`
- a field you have edited is kept; if `film.json` changed it too, the scan reports
  the conflict once, and **Reset to film.json** on the film takes the file's version

Media (playlists, artwork, subtitles) always follows the folder. New films are
always unpublished. A film whose folder disappears is marked missing, not deleted.

Don't rename a film's folder once tickets are out. Tickets belong to the film,
not its address, but a renamed folder imports as a new, unpublished film, and the
old one (with its tickets) is marked missing. Renaming it back restores it, and
leaves the film created under the new name behind, marked missing.

Symlinks inside a film folder are fine if they point to something in the same
folder. The server never serves a file that really lives anywhere else, and the
scan reports a listed file, playlist or segment folder that does.

A value TMDB filled in counts as the file's, not yours: if you later add that
field to `film.json`, the file's value replaces it. See [metadata.md](metadata.md).
