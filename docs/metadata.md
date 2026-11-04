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

On a server you can set `TMDB_API_KEY` in `deploy/.env`
([the settings](installing.md#settings)) instead; it then takes
precedence over the admin setting.

## What happens

**When a scan finds a new film**, the server looks it up in the background. It
cleans up titles that came from file names (`Hedwig.and.the.Angry.Inch.2001.1080p…`
becomes "Hedwig and the Angry Inch", 2001) and searches TMDB. A title only counts
as a file name when it's shaped like one: dots or underscores between the words,
or words such as `1080p` and `BluRay`. A real title such as *Charlotte's Web* is
searched for as it is.

It only applies a match it's sure of: exactly one film with the same title and
year. If none is from that year, exactly one from the year before or after will
do, and a film with no known year needs exactly one film with the same title.
Then it:

- fills fields that are empty: title, original title, year, running time,
  directors, country, synopsis, and a content note from the certificate
  (for example "Rated R")
- replaces a title that came from a file name, or that differs from TMDB's only
  in punctuation, accents or capitals ("Paris Texas" becomes "Paris, Texas"),
  unless you've edited the title in the admin
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
`themoviedb.org/movie/13403`. You can also add it later, to settle a film marked
**Choose a TMDB match**: the next scan applies it. A match that's already been
made, by hand or automatically, is kept.

## Who wins

Highest first:

1. **Your edits in the admin.** Editing a field that came from TMDB makes it
   yours; rescans and matches leave it alone. So does taking TMDB's value with
   **Find details…** in place of one `film.json` gives.
2. **`film.json`.** A value you add to `film.json` later replaces one TMDB filled in.
3. **TMDB**, for whatever is still empty.

**Reset to film.json** on a film's page undoes your edits only: each field marked
"edited here" goes back to what `film.json` says, and what TMDB filled in stays. The
button shows only when there's an edit to undo. A field TMDB filled in that you then
edited is yours, so it goes back to `film.json` too, which may leave it empty; use
**Find details…** to fill it from TMDB again. A value you took with **Find
details…** in place of `film.json`'s goes back to `film.json`'s; one it put in a
field `film.json` leaves empty is TMDB's, and stays.

Your recommendation is never touched. Artwork from the film folder is kept
unless you pick TMDB's by hand; **Don't use TMDB's** under an image goes back to
the folder's own.

## Privacy

The server sends TMDB the titles and years it searches for, along with your key.
Posters and backdrops are downloaded to the server (`DATA_DIR/artwork`) and
served with the same access rules as the film folder's artwork, so viewers'
browsers never contact TMDB and nothing about your viewers is sent there. The
server only takes them from TMDB's image server, and only if they really are
JPEG, PNG or WebP images of at most 15 MB. A ticket
link's preview in a chat app shows the same poster, fetched from your server, not
from TMDB ([access.md](access.md#link-previews)). Only the admin's own browser loads
TMDB thumbnails while you're choosing a match.

## Credit

TMDB's terms ask for credit wherever its data appears. When a key is set, the
site footer says "Film information and images from TMDB". This product uses the
TMDB API but is not endorsed or certified by TMDB. Personal, non-commercial use
of the API is free; check TMDB's terms if that changes.
