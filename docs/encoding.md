# Encoding films

Open Matte serves media you prepared; it never transcodes. `scripts/encode.mjs`
is a reference encoder that produces a folder in the [import format](import-format.md).
It needs `ffmpeg` and `ffprobe` (`brew install ffmpeg` on a Mac).

```bash
npm run encode -- ~/Films/Arrival.mkv media/arrival --subs
```

That probes the source, picks a ladder, and writes `hls/`, `subtitles/` and a
`film.json` to fill in. The title and year come from the file name, so
`Paris.Texas.1984.1080p.BluRay.x264-GRP.mkv` gives "Paris Texas" (1984). With
[film information](metadata.md) turned on, the server fills in the rest from TMDB. Add a `poster.jpg`, write your recommendation, then copy
the folder to the server (see [deploying](deploying.md)).

## Options

| Option | Meaning |
|---|---|
| `--ladder 2160:hevc:hdr,1080:hevc,1080:h264,720:h264` | Renditions as height:codec[:hdr]. |
| `--audio 1:en:English,2:en:Audio description:ad,1:en:Surround:surround` | Audio streams as index:language:name[:ad\|:surround]. The index counts audio streams only. The first entry is the default. |
| `--subs` | Convert text subtitle streams (SRT, ASS, mov_text) to WebVTT. Image subtitles (PGS) need OCR first. |
| `--hw` | Use VideoToolbox on a Mac: much faster, larger files, no HDR. |
| `--preset slow` | x264/x265 preset. Default `medium`. |
| `--seconds 60` | Encode only the first minute, to try settings. |
| `--dry-run` | Print the ffmpeg commands only. |

## Default ladders

| Source | Renditions |
|---|---|
| 4K HDR | 2160p HEVC HDR, 1080p HEVC HDR, 1080p HEVC SDR, 1080p H.264 SDR, 720p H.264 SDR |
| 4K SDR | 2160p HEVC, 1080p HEVC, 1080p H.264, 720p H.264 |
| 1080p | 1080p HEVC, 1080p H.264, 720p H.264 |
| 720p | 720p HEVC, 720p H.264, 480p H.264 |

Every ladder includes an H.264 SDR rendition, because HEVC support depends on the
browser, operating system, hardware decoder and exact encoding. The 1080p HEVC HDR
rung is there so HDR viewers on slower connections aren't stuck with one 4K option.

Quality is constant-quality (CRF) with a peak-rate cap, so simple scenes stay
small. Keyframes are every 2 seconds and segments 6 seconds, aligned across
renditions so players can switch cleanly. Segments are fMP4 (CMAF); HEVC is
tagged `hvc1` for Safari. The master playlist gets measured `BANDWIDTH` and
`AVERAGE-BANDWIDTH`, real `CODECS` strings and `VIDEO-RANGE`.

Audio is AAC: stereo at 160 kbit/s by default, 5.1 at 384 kbit/s for `:surround`.
Audio description tracks are marked so players can label them.

## HDR

HDR renditions keep HDR10 (PQ) or HLG, including mastering-display and light-level
metadata when the source has it. SDR versions of an HDR source are tone-mapped,
which needs an ffmpeg built with zimg (the `zscale` filter). Homebrew's ffmpeg
doesn't include it; the script stops and says so. Use a static build from
ffmpeg.org or the homebrew-ffmpeg tap. Dolby Vision is not preserved; its HDR10
base layer is.

The HDR path has not yet been tested against a real HDR source. Check the first
HDR film carefully on an HDR screen and an SDR one.

## Storage

Roughly 50 GB for a two-hour 4K HDR film with the full ladder, so 1 TB holds about
20 films. Drop rungs to save space: a film without a 4K source might be 8 to 15 GB.
