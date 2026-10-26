# Film information and artwork from TMDB

Like Jellyfin, Open Matte can fill in a film's details and fetch its poster and
backdrop from [TMDB](https://www.themoviedb.org) (The Movie Database). It's
optional: without a key, everything comes from `film.json` and the admin.

## Turning it on

1. Create a free TMDB account, then go to **Settings → API** and request a
   developer key for personal use.
2. In Open Matte's admin, open **Settings → Film information** and paste either
   value from that page: the **API Key** or the **API Read Access Token**. The key
   is checked with TMDB before it's saved.
3. Pick the language for titles and synopses (English (US) by default).

On a server you can set `TMDB_API_KEY` in `deploy/.env` instead; it then takes
precedence over the admin setting.

## What happens

**When a scan finds a new film**, the server looks it up in the background. It
cleans up titles that came from file names (`Hedwig.and.the.Angry.Inch.2001.1080p…`
becomes "Hedwig and the Angry Inch", 2001) and searches TMDB. It only applies a
match it's sure of: exactly one film with the same title and year. Then it:

- fills fields that are empty: title, original title, year, running time,
  directors, country, synopsis, and a content note from the certificate
  (for example "Rated R")
- replaces a title that came from a file name, or that differs from TMDB's only
  in punctuation, accents or capitals ("Paris Texas" becomes "Paris, Texas")
- downloads TMDB's poster and backdrop if the film folder has none

If it isn't sure (two films called *Twins* from 1988, say), it changes nothing
and the film is marked **Choose a TMDB match** in the admin. Saving a key also
looks up every film that hasn't been matched yet.

**By hand**, on a film's admin page under *Film information*: **Find details…**
searches TMDB, you choose the right film, then tick which fields to take and
pick a poster and backdrop from TMDB's options. Fields you tick replace what's
there; nothing else changes.

To pin a match from the start, put the film's TMDB number in `film.json` as
`tmdbId`: it's the number in the film's TMDB address, such as
`themoviedb.org/movie/13403`.

## Who wins

Highest first:

1. **Your edits in the admin.** Editing a field that came from TMDB makes it
   yours; rescans and matches leave it alone.
2. **`film.json`.** A value you add to `film.json` later replaces one TMDB filled in.
3. **TMDB**, for whatever is still empty.

Your recommendation is never touched. Artwork from the film folder is kept
unless you pick TMDB's by hand; **Don't use TMDB's** under an image goes back to
the folder's own.

## Privacy

The server sends TMDB the titles and years it searches for, along with your key.
Posters and backdrops are downloaded to the server (`DATA_DIR/artwork`) and
served with the same access rules as the film folder's artwork, so viewers'
browsers never contact TMDB and nothing about your viewers is sent there. Only
the admin's own browser loads TMDB thumbnails while you're choosing a match.

## Credit

TMDB's terms ask for credit wherever its data appears. When a key is set, the
site footer says "Film information and images from TMDB". This product uses the
TMDB API but is not endorsed or certified by TMDB. Personal, non-commercial use
of the API is free; check TMDB's terms if that changes.
