# Tickets, screenings and sessions

The goal is "private enough for friends", not DRM. These are the rules the code
follows; `server/access.js` implements them and `test/journey.test.js` checks them.

## Three different records

| Record | What it is | Created when |
|---|---|---|
| **Ticket** | An "admit one" invitation to one film, with its own link | The admin issues it |
| **Session** | A browser's sign-in, held in an HttpOnly cookie | Someone opens a ticket link |
| **Screening** | One use of a ticket | Someone presses Play |

## Tickets

A ticket is a **bearer invitation**: whoever has the link can use it. The name you
give it is a label for you, not an identity check. (Passkey-bound tickets that do
check identity are planned for milestone 2.)

Each ticket has, all optional:

- **Screening limit**: how many screenings it allows.
- **Start by**: if the first screening hasn't started by this date, the ticket expires.
  Once it has started, the deadline no longer matters.
- **Days after first play**: the ticket expires this long after the first screening starts.
- **Revocation**: immediate, and can be undone.

The expiry clock starts at first **playback**, not when the link is opened, so a
preview visit or a chat app's link scanner doesn't start the countdown.

## Opening a link

`/t/<code>` is a page that sends the code to `/api/tickets/open` from JavaScript,
receives a session cookie, and replaces the URL with the film's clean address.
Link previews in chat apps fetch the URL but don't run scripts, so they create no
session and no "opened" event. The code is never used again after the exchange.

## Screenings

| Action | Result |
|---|---|
| Open a ticket link | Shows the film page. No screening is used. |
| Press Play | Resumes the ticket's open screening, or starts a new one if the limit allows. |
| Pause, refresh, reconnect | Continues the same screening. |
| Switch device | The new device takes the screening over once the old one has paused, closed the tab, or gone quiet for about 75 seconds. Two devices can't play one screening at once. |
| Reach the limit | No new screenings; an open one can still be resumed. |
| Revoke the ticket | Page and media requests fail from the next request on. |

A screening can be resumed for a fixed window after it starts: **48 hours** by
default, set in the admin under Settings. Changing it affects new screenings only.
Ticket expiry always wins over a resume window that is still running.

Checking the limit and creating the screening happen in one write transaction,
so two simultaneous presses of Play can't both take the last screening.

## Media requests

Every request under `/media/<film>/` is checked:

- posters and backdrops need a ticket that can see the film page
- master and child playlists, init segments, media segments, audio and subtitles
  need a valid session holding a valid ticket for that film, the film published
  and playable, the ticket not revoked or expired, **and** an open screening that
  this browser currently holds

So knowing a file's URL is not enough, and neither is holding a ticket without
pressing Play. Revocation stops future requests; it can't take back what is
already in the player's buffer (typically under a minute of video).

A browser signed in to the admin plays in preview mode and never uses a screening.

## What is recorded

- **opened**: the film page was loaded with a ticket (at most once per 30 minutes per browser)
- **play**: a screening started or resumed
- **heartbeat**: playback position, reported every 30 seconds while playing and
  logged every 5 minutes
- **finished**: playback reached 92% of the running time (decided on the server)

Plus a coarse device label such as "Safari on iPhone". No IP addresses and no full
user-agent strings are stored. Viewers are told on the film page that progress is
recorded. This is operational information, not proof that anyone watched.
