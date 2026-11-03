# Tickets, people and screenings

The goal is "private enough for friends", not DRM. These are the rules the code
follows: `server/access.js` implements the ticket rules, `server/people.js` and
`server/webauthn.js` people and passkeys, and the tests in `test/` check them.

Milestone 2, planned in [milestone-2.md](milestone-2.md), adds people and passkeys,
tickets that only one person can use, signed in, keeping a ticket in an account,
films shown to members and an account page. Checks on real devices are listed in
[device-checks.md](device-checks.md). Milestone 3 ([milestone-3.md](milestone-3.md))
changes none of these rules; it adds [link previews](#link-previews) that show a
ticket's film, shows the film playing [on the lock screen](#on-the-lock-screen), and
deletes old activity after a time you choose ([How long it's kept](#how-long-its-kept)).

## The records

| Record | What it is | Created when |
|---|---|---|
| **Ticket** | An "admit one" invitation to one film, with its own link: for anyone with the link, or only for one person | The admin issues it |
| **Session** | A browser's sign-in, held in an HttpOnly cookie | Someone opens the link of a ticket for anyone, or signs in with a passkey |
| **Screening** | One use of a ticket | Someone presses Play |
| **Person** | Someone you've added, who can sign in | You add them |
| **Passkey** | A person's sign-in key, kept by their phone, computer or password manager | They create it from a link you sent |
| **Setup or recovery link** | A single-use link for creating a passkey | You create it for one person |

## Tickets

Every ticket is one of two kinds, chosen when you issue it:

- **For anyone with the link**: a **bearer invitation**, as in milestone 1. Whoever
  has the link can use it, in any browser. The name you give it is a label for you,
  not an identity check, and signing in doesn't change that.
- **Only for one person, signed in**: it works only in a browser signed in as that
  person with their passkey. The link is just a way to reach it, and forwarding it
  does nothing.

Afterwards only two things change who a ticket is for: someone keeping a ticket for
anyone that you've let them keep, and you giving a ticket to a person or letting
anyone with the link use it again (see [Keeping a ticket](#keeping-a-ticket)). A
ticket for a person needs them to be enabled, and is issued one at a time. They
don't need a passkey yet: send them a setup link that carries the ticket (see
[Setup and recovery links](#setup-and-recovery-links)).

Each ticket has, all optional:

- **Screening limit**: how many screenings it allows.
- **Start by**: if the first screening hasn't started by this date, the ticket expires.
  Once it has started, the deadline no longer matters.
- **Days after first play**: the ticket expires this long after the first screening starts.
- **Revocation**: immediate, and can be undone.

The expiry clock starts at first **playback**, not when the link is opened, so a
preview visit or a chat app's link scanner doesn't start the countdown.

### Two kinds of ticket

| | For anyone with the link | Only for one person, signed in |
|---|---|---|
| Who can use it | Any browser that opened the link | Any browser signed in as that person; they don't need to open the link |
| Opening the link | Adds it to this browser | Signed in as the person: opens the film. Not signed in: a sign-in page, with nothing created or recorded. Signed in as someone else: told it's for someone else |
| Forwarding the link | Works for whoever gets it | Does nothing |
| Its link's preview in a chat app | The film's title and poster (see [Link previews](#link-previews)) | Only the cinema's name and logo, never the film |
| Under Your tickets | In that browser only | On every device the person signs in on |
| TVs and in-app browsers | Work | Need a browser that can use passkeys |
| Revoke / restore | Stops on the next request; after a restore, browsers must open the link again | Stops on the next request; after a restore it works for the person at once |
| **Sign out browsers** | Forgets it in every browser that opened the link | No browser holds it: use the person's **Sign out everywhere**, or revoke the ticket. For a ticket that was kept or given, it forgets the browsers that opened the link before, so they don't get it back if you release it |
| Person disabled | Not affected | Stops on the next request |
| Limits, start by, days after first play, resume window, one device at a time | The same | The same |

### Who can do what

| Browser | A ticket for anyone, whose link it opened | A ticket only for P | A film shown to members, with no ticket for it |
|---|---|---|---|
| Anonymous | page, Play, stream | nothing (the link shows a sign-in page) | nothing |
| Signed in as P | page, Play, stream | page, Play, stream, on every device | page and poster |
| Signed in as Q | page, Play, stream | nothing (the link says it's for someone else) | page and poster |
| P disabled | P's sessions are gone, so P is anonymous and can open link tickets again | nothing | nothing |

The rules behind both tables:

1. A **ticket for anyone with the link** can be used by a browser if and only if that
   browser opened its link.
2. A **ticket for one person** can be used by a browser if and only if that browser is
   signed in as that person. Having opened its link grants nothing.
3. A browser counts as **signed in** only while its session is unrevoked and unexpired
   and its person exists and isn't disabled, checked on every request (see
   [Signing in and out](#signing-in-and-out)).
4. **Listing never grants playback.** Your tickets shows only tickets the browser
   could use anyway, and a film shown to members is only listed and described;
   being listed lets nothing play.
5. Who may use a ticket is decided in one place, the lookups in `server/access.js`. A
   ticket's own state (its limits, expiry and revocation) is the same whoever asks.

## Opening a link

`/t/<code>` is a page that sends the code to `/api/tickets/open` from JavaScript.
Link previews in chat apps fetch the URL but don't run scripts, so they create no
session and no "opened" event (what they're shown is under
[Link previews](#link-previews)). Unknown and revoked tickets, and tickets for an
unpublished film, are refused first, whichever kind they are.

For a ticket for anyone with the link, the page receives a session cookie and
replaces the URL with the film's clean address straight away. The code is never used
again after the exchange.

For a ticket for one person:

- **Signed in as that person**: the page goes to the film. Nothing is added to the
  browser: the ticket is already theirs on every device they sign in on.
- **Not signed in**: a sign-in page. No session or cookie is created, the ticket
  isn't marked as opened and no event is recorded, and the server says neither
  which film it is nor who it's for. Once they've signed in, the page opens the
  ticket again and goes to the film.
- **Signed in as someone else**: told the ticket is for someone else. Again nothing
  is created or recorded.
- **This browser opened the link while it was for anyone**, and someone has kept it
  since (or you gave it to someone): told it has been kept in someone's account, and
  to ask whoever sent it.

Until the person signs in, the code stays in the `/t/` address, so "Open in Safari"
from an app's built-in browser, which can't use passkeys, takes the ticket with it.
The code is useless to anyone but that person, and pages send no Referer.

The person doesn't need the link at all once they're signed in: the ticket is under
Your tickets on every device they sign in on. For such a ticket, **Opened** on the
admin's ticket page is the first time they opened its link or its film page, signed
in.

### Link previews

Chat apps that show a preview of a link (WhatsApp, iMessage and the like) read tags
that the server writes into the page as it sends it. For a `/t/<code>` address:

- **A ticket for anyone with the link** previews its film: the title and year, the
  poster, and "A ticket from" followed by your cinema's name. That holds while the
  ticket isn't revoked and its film is published, exactly when opening the link would
  show someone the film. A ticket that's used up or expired still previews its film,
  since opening it still shows the film page.
- **A ticket for one person**, including one that was kept or given, previews as the
  cinema: its name, and its logo if you've uploaded one. A browser that isn't signed
  in as that person learns neither the film nor who it's for, and a preview fetcher
  is such a browser.
- **A revoked ticket, a ticket for an unpublished film, or an unknown code** previews
  as the cinema too, as every other page on the site does.

The poster has an address of its own, made for the preview: `/poster/<id>.<mac>`,
where `<id>` is the ticket's number and `<mac>` is worked out from it with a key the
server never sends anywhere. A preview image's address gets passed around: some chat
apps repeat it in their own image servers' addresses, and people copy it. So this one
holds neither the ticket's code nor anything that opens the ticket. It can fetch the
poster and nothing else, and without the key nobody can make the address for another
ticket. It needs no session, and works only while the link would preview its film:
once the ticket is revoked, kept or given, or its film unpublished, it answers 404 and
says nothing more. It serves the poster the film page shows, TMDB's if one was
downloaded, otherwise the film folder's.

Fetching the page or the poster creates and records nothing: no session or cookie,
no "opened" event, and the ticket isn't marked as opened. Only the page's script,
in a browser that runs it, opens the ticket. The page and the poster share a rate
limit per visitor. Over it, the page is still served, but previews as the cinema,
and the poster answers 404.

A preview that shows the film tells whoever fetched it which film you sent. Apps that
fetch previews on their own servers learn it there; iMessage and WhatsApp fetch them
on the phone instead. That was a deliberate choice for milestone 3 (see
[milestone-3.md](milestone-3.md#branding-3-november-as-slice-1-started)). To send a
link whose preview doesn't name the film, issue a ticket for one person. A preview is
made when the link is sent and stays in the conversation, so revoking the ticket
stops its poster address but doesn't take back a preview already shown.

## Keeping a ticket

A ticket for anyone with the link can be marked **Let them keep it in their account**,
when you issue it or later on its page. It's off by default. A signed-in person whose
browser holds such a ticket (it opened the link, or opened it before they signed in
there) can then press **Keep it** on the film page; someone not signed in is offered
**Sign in and keep it**. Keeping makes it a ticket only for them, signed in, as if
you'd issued it that way: it's under Your tickets on every device they sign in on,
and the link works for nobody else.

| | Before | After Sam keeps it | After you choose **Let anyone with the link use it** |
|---|---|---|---|
| Who can use it | Any browser that opened the link | Only Sam, signed in | Any browser that opened the link, again |
| Browsers that opened the link | Hold it | Lose it from their next request, and are told "This ticket has been kept in someone's account. Ask whoever sent it." (no name) | Hold it again, unless you signed them out of it or revoked it meanwhile |
| Sam's devices | Only browsers that opened it | Every device Sam signs in on | Lose it, unless they opened the link |
| An open screening | Where it is | Sam can take it over at once, at the same place | The same rule |
| Screenings used, first play, expiry, resume deadline | Unchanged throughout | | |

The rules:

- **The first keep wins.** Keeping checks and changes the ticket in one write
  transaction, so of two people keeping it at once, exactly one gets it and the other
  is told it has been kept. Only you can change it after that.
- **Only a ticket in the `ok` state** can be kept: not one that's used up, expired,
  revoked or unavailable.
- **Not while another browser is playing it.** If a browser that can still play the
  ticket is playing it right now, keeping is refused until it pauses, closes or goes
  quiet (about 75 seconds). So a keep never stops a film someone is watching.
- **The screening follows the ticket.** A screening left in a browser that lost the
  ticket isn't voided or used again: the keeper resumes it where it was, within the
  same resume window, without waiting.
- **Nothing else changes**: limits, start by, days after first play and the resume
  window are as they were. **Opened** and **First played** keep their dates.
- Keeping is never offered while the player is open, and a browser that can't use
  passkeys is told to open the link in Safari or Chrome to keep it.

On the ticket's page you can also:

- **Let anyone with the link use it**: the ticket is for anyone again, not keepable
  unless you tick the box again. The person loses it from their next request (an open
  screening can then be taken over at once), and browsers that opened the link get it
  back.
- **Give it to a person** (or to someone else): only they, signed in, can use it from
  the next request. You can do this with any ticket, kept or not; browsers that opened
  the link lose it and are told it has been kept. A ticket you gave shows as "Only Sam,
  signed in"; one Sam kept shows as "Only Sam · kept from a link".
- See which browsers opened the link before it was kept or given, and **Forget it in
  these browsers**, so a release gives it to nobody until the link is opened again.

Revoking a kept ticket also forgets those browsers, as it does for any ticket.

## Films shown to members

Each film has a **Show to members** switch on its admin page, off to begin with. While
it's on and the film is published, every browser signed in as a person sees the film
under **Showing to members** on the front page, marked "No ticket yet", and can read
its page: poster, backdrop, details and your recommendation. Where Play would be,
the page says they don't have a ticket and to ask whoever runs the cinema.

- **It never plays.** Play is refused (`no-ticket`) and no screening starts, and
  playlists, segments, audio and subtitles are refused exactly as for any film
  without a ticket. To let someone watch, issue them a ticket: the film then moves
  to Your tickets and plays.
- **Only signed-in people see it.** A browser that isn't signed in gets the front
  page it always did, and the film's address says nothing is showing there, even if
  the browser holds link tickets for other films.
- **It goes from the next request** when you switch it off or unpublish the film,
  or when the person signs out or is disabled. Switching it off doesn't affect
  tickets for the film.
- **A ticket in a worse state wins.** Someone whose ticket for the film is used up
  or expired sees that ticket's page, which says so, not the member page. Someone
  whose ticket was revoked sees the member page again.
- **Reading it records nothing**: no "opened" event, and no ticket is marked as
  opened.
- A draft can be switched on ahead of time: members see it once it's published.

## Screenings

| Action | Result |
|---|---|
| Open a ticket link | Shows the film page (for a ticket for one person, once they're signed in). No screening is used. |
| Press Play | Resumes the ticket's open screening, or starts a new one if the limit allows. |
| Pause, refresh, reconnect | Continues the same screening. |
| Switch device | The new device takes the screening over once the old one has paused, closed the tab, or gone quiet for about 75 seconds. Two devices can't play one screening at once. |
| The device playing can no longer play: it was signed out (by its viewer or by you), its session expired, its person was disabled, or **Sign out browsers** took the ticket out of it | Another device can take the screening over at once, without waiting. This covers link tickets too, for example after **Sign out every viewer**. |
| Two devices signed in as the same person, with a ticket for them | One at a time, with the same takeover rules as two browsers that opened the same link. |
| Reach the limit | No new screenings; an open one can still be resumed. |
| Revoke the ticket | Page and media requests fail from the next request on. |
| Unpublish the film | The page disappears and playback under way stops, for every ticket. Publishing again restores both; open screenings keep their place, and their resume windows keep running meanwhile. |
| The film's folder goes missing, or a scan finds errors in it | The page stays and says the film isn't available right now; nothing plays and no screening can start. Resume windows keep running meanwhile. |
| The ticket is kept, given or released | Its open screening stays as it is. A browser that can no longer use the ticket stops on its next request, and whoever can use it now can take the screening over at once. |

A screening can be resumed for a fixed window after it starts: **48 hours** by
default, set in the admin under Settings. Changing it affects new screenings only.
Ticket expiry always wins over a resume window that is still running.

Checking the limit and creating the screening happen in one write transaction,
so two simultaneous presses of Play can't both take the last screening.

A browser can have more than one ticket it may use for a film: say a link ticket it
opened and one for the person it's signed in as. Then the ticket in the best state
wins; among those, one with an open screening this browser could resume now, rather
than one another browser is busy playing; then the person's own ticket; then the
oldest. The film page, Play and Your tickets all go by the same choice.

### On the lock screen

While a film plays, the phone's lock screen and Control Center, and Chrome's media
controls, show its title and poster, with the cinema's name. So anyone who can see the
screen can see which film it is. For when the title is part of the surprise, untick
**Show the film's title and poster on lock screens and media controls** in Settings:
every viewer then sees only the cinema's name, with no poster. It's on by default.

Play, pause and skipping back or forward there, or on headphones, work the player
itself. So the screening, its progress reports and the one-device rule see them
exactly as they see the page's own controls. When the player stops (the screening
moved to another device, the ticket ended, it was refused, an error) or closes, it
takes the film and its buttons off the lock screen, so they can't start a screening
that has stopped.

## Media requests

Every request under `/media/<film>/` is checked:

- posters and backdrops need whatever lets the browser see the film page: a ticket,
  or, for a film shown to members, being signed in as a person
- master and child playlists, init segments, media segments, audio and subtitles
  need a valid session that may use a ticket for that film under the rules above
  (it opened the link of a ticket for anyone, or it's signed in as the ticket's
  person), that ticket in the `ok` state (the film published and playable, the
  ticket not revoked or expired), **and** an open screening of that ticket which
  this browser currently holds

So knowing a file's URL is not enough, nor is having the link of a ticket for one
person without being signed in as them, nor holding a ticket without pressing
Play. A ticket for one film unlocks nothing of another, and a file in a
film folder that is really a symlink to somewhere outside it is never served.
Media responses are marked `private`, so only the viewer's own browser caches them.
Revoking a ticket, signing a browser out, disabling a person or removing a passkey
stops future requests, playlists and segments included; none of them can take back
what is already in the player's buffer (typically under a minute of video).

Outside `/media/`, two kinds of image need no session. A ticket's preview poster,
`/poster/<id>.<mac>`, follows the rule under [Link previews](#link-previews). The
cinema's own logo and tab icon (`/branding/<file>`) and Open Matte's icon drawn in
its colours (`/favicon.svg`) are public, unlike a film's artwork: the sign-in page
and every link preview show them to anyone. An uploaded logo or icon is only ever a
PNG, JPEG or WebP image, checked by its bytes, never an SVG, which can carry script.

A browser signed in to the admin plays in preview mode and never uses a screening.
Who a ticket is for doesn't matter there either, so check tickets for one person in
a browser that isn't signed in to the admin. The site says so when a browser is
signed in to both.

## People and passkeys

A **person** is someone you've added in the admin under **People**. Nobody can sign
up on their own, and nobody needs an account to watch a ticket for anyone with the
link: those work in any browser, TVs included. A ticket for one person needs that
person's passkey.

- **Name**: shown to the person, and saved in their password manager with the
  passkey. Names are unique (ignoring case) and up to 80 characters. Renaming
  someone changes what the site shows, not what their password manager has already
  saved. Nothing ever signs in by name.
- **Note**: for you only, and never sent to a viewer, so "Sam (rude about Nolan)"
  can't end up in Sam's keychain.
- People are **disabled, not deleted**. There's no way to delete someone in this
  milestone.

A **passkey** is a sign-in key that the person's phone, computer or password manager
creates for this site. The device keeps the private half and unlocks it with Face
ID, a fingerprint or the screen lock; the server keeps only the public half, so
there's no password to steal or reuse, and the server never sees a face or a
fingerprint. A passkey is either **Synced** (saved to their Apple ID, Google account
or password manager, so it's on every device signed in to that) or **This device
only**. Passkeys belong to the domain set as `WEBAUTHN_RP_ID` (see
[deploying.md](deploying.md#passkeys)): if the site ever moves to another domain,
everyone needs a new one.

"Signed in as Sam" really means "someone who can unlock Sam's passkeys". A family
sharing an Apple ID or a password manager shares those too.

People can't add or remove passkeys themselves in this milestone; only a link from
you creates one. On a new computer they can sign in with the passkey on their phone
(the browser offers to use a phone, with a QR code), and a synced passkey turns up
on their other devices by itself. If neither works, send them an **Add a sign-in
method** link (below). Letting a signed-in browser add a passkey would turn a stolen
cookie into a permanent way in.

Passkeys need a real browser: the built-in browsers of some apps (Instagram,
Facebook and the like) don't handle them, so the person may need to open the link in
Safari or Chrome. TV browsers usually can't use them either, so for watching on a
TV's own browser, issue a ticket for anyone with the link.

## Setup and recovery links

A person creates a passkey only from a link you made for them: a **setup link** the
first time, a **recovery link** ever after.

- **Which kind.** A link is a setup link until the person has created a passkey with
  one. From then on every link is a recovery link, even after you've removed all
  their passkeys.
- **How long it works.** A setup link works for 1 hour, 1 day, 3 days (the default)
  or 7 days. A recovery link works for 1 hour (the default) or 1 day, because it's
  the most attractive to steal.
- **Single use.** Creating a passkey uses the link up; opening it doesn't, so a chat
  app's link preview or a mail scanner can't spend it. The person page shows when
  it was first opened, which may have been a scanner rather than the person. If two
  browsers finish one link, the first wins, and the second is told the link has
  already been used and to tell whoever sent it straight away.
- **One at a time.** Creating a link cancels any other waiting link for that person.
  You can also cancel one yourself, and disabling a person cancels theirs.
- **It can carry a ticket.** A link can carry a ticket for that person that isn't
  revoked; once the passkey is created, the page takes you on to the film. So a
  friend with no passkey yet still gets one link that ends on the film. A ticket's
  own link never creates a passkey: ticket codes are stored as they are and can be
  copied again, so if one could, a leaked ticket would become a way into the account.
- **Shown once.** The server keeps only a hash of the link, so you see it once, when
  you create it. If it goes astray, create a new one: the old one then stops working.
- **In the fragment.** Links look like `https://your-domain/enroll#<token>`. Browsers
  never send the part after `#` to a server, so the token isn't in Caddy's logs, the
  app's logs or the request a link previewer makes.

What protects a link is that it's secret, single-use and short-lived. Anyone holding
it can create a passkey and become that person, with no device needed: a script
would do. Send it only to the person, on a contact you know is theirs. The person
page shows where a used link was used, and the person hears about new passkeys the
next time they sign in (below).

### Helping someone sign in again

**Help Sam sign in again** creates a recovery link. First it asks for a tick: "I'm
replying on a contact I already know is Sam's: not a new number or account". The
server refuses a recovery link without it. If someone says they've lost their phone,
a quick call is the surest check.

Then there are two choices:

- **Add a sign-in method**: Sam's passkeys keep working. For a new device that can't
  use the phone's QR code, or a move to another password manager.
- **Reset after loss**: removes all of Sam's passkeys and signs Sam out of every
  browser **when you create the link**, not when it's used, so a lost or stolen
  device is cut off at once. The link then creates a new passkey.

A caveat with synced passkeys: the new passkey is saved to Sam's Apple ID, Google
account or password manager, and from there it reaches every device still signed in
to that account, a stolen one included. So if a device was stolen, Sam should remove
it from that account, or change that account's password, before using the link.

## Signing in and out

Signing in is one button at `/signin`: no username and no password. The browser
offers the passkeys it has for this site, or a passkey on a phone.

Signing in always creates a **new session and cookie** and ends the browser's old
session, so a cookie someone planted beforehand never becomes a signed-in one.
Creating a passkey from a link signs in the same way. Then:

| | This browser | Link tickets opened here, and a screening held here | The person's other browsers |
|---|---|---|---|
| Sign in, from anonymous or from the same person | New cookie; old session ended | Carried over; playback continues | Unaffected |
| Sign in, from someone else's session | New cookie; old session ended | Not carried over (they were the other person's); the screening is freed | Unaffected |
| Sign out | Cookie cleared; session ended | Forgotten (the links still work if opened again); the screening is freed | Unaffected |
| Sign out everywhere, from the account page | Cookie cleared; session ended | Forgotten; the screening is freed | Signed out too, and playback stops on their next request |

**Your account** (`/account`, in the menu under their name) shows a signed-in person
their passkeys (Synced or This device only, when and where each was added, whether
from the setup link or a recovery link, when last used, and which one signed in
this browser) and every browser signed in as them (device, when it signed in, when
last seen, and which is this one). It shows only their own, with no ids. From there
they can **Sign out**, or **Sign out everywhere**, which signs out every browser
signed in as them, this one included; their passkeys still work. Adding or removing
a passkey is still something they ask you for.

You can sign people out too (below). Whichever way a browser is signed out, it
forgets the link tickets it opened, and a screening it held is freed at once.

Tickets for the person themselves aren't held by any browser: every browser signed
in as them can use them, and a browser that signs out simply can't any more.

When someone signs in, they're told about any passkey added to their account since
the one they're using last signed in, with when and from which device. Only someone
holding that passkey moves that point on, so a passkey created from an intercepted
link gets noticed even if it has been used since.

A sign-in is refused when:

- the server doesn't know the passkey (you removed it, perhaps with Reset after
  loss). These attempts aren't recorded: there's nobody to record them against.
- the signature is bad, the response is for another site, or its challenge has
  expired or was already used.
- a passkey that stays on one device reports a counter that hasn't moved on, which
  can mean it was copied. This is recorded. Synced passkeys don't keep a counter.
- the person is disabled. This is recorded, and only said after a valid signature,
  so nobody can find out that an account is disabled without its passkey.

A person's sessions last the same 90 days as any viewer's (`VIEWER_SESSION_DAYS`),
use the same cookie, and **Sign out every viewer** in Settings covers them too. A
session counts as signed in only while it's unrevoked and unexpired and its person
exists and isn't disabled; that's checked on every request, playlists and segments
included.

## Disabling people and removing passkeys

- **Disable** signs the person out everywhere, cancels any waiting link, and refuses
  their passkeys until you enable them. It doesn't remove passkeys: for a lost or
  stolen device, use **Reset after loss**. A disabled person is simply anonymous, so
  like anyone else they can still watch with a ticket for anyone, by opening its link
  again. Tickets only for them stop working from the next request, playlists and
  segments included. Once you enable them and they sign in, those work again, and
  an open screening resumes where it was if its resume window is still running.
- **Enable** lets them sign in again with the passkeys they have. A link that
  disabling cancelled stays cancelled.
- **Sign out everywhere** signs the person out of every browser. Their passkeys still
  work.
- **Remove** a passkey: it stops working at once, and the browsers it signed in are
  signed out. Their other passkeys, and the browsers those signed in, are
  unaffected. The passkey stays in their password manager, but is refused here.
  Removed passkeys are deleted; Activity keeps the device they were added from, for
  as long as it keeps the event (see [How long it's kept](#how-long-its-kept)).

## Secrets and sessions

- Ticket codes are about 64 random bits. They're stored as they are, so the admin
  can copy a link again later; anyone who can read the database could use the ones
  for anyone with the link. A ticket for one person still needs their passkey.
- Poster addresses for [link previews](#link-previews) are made with a key of 256
  random bits, created once and kept in the database. The key is never sent anywhere.
- Session cookies are 256 random bits, HttpOnly, SameSite=Lax, and Secure over
  HTTPS. The database keeps only their SHA-256 hash. Admin sign-out, session
  expiry, ticket revocation, signing a person out and signing out every viewer (in
  Settings) take effect on the server, from the next request.
- Setup and recovery link tokens are 256 random bits. The database keeps only their
  SHA-256 hash, so a link can't be shown again, and a leaked database or backup
  holds no usable link.
- For each passkey the database keeps its public key and credential id, neither of
  which can be used to sign in. Credential ids go only to whoever holds a link for
  that person (so their device can tell it already has one), never to anyone else.
- Challenges, the one-off values a passkey signs, live in memory only. Each lasts
  5 minutes, is taken once whatever the outcome, and is tied to its purpose (and a
  setup challenge to its link), so a response can't be replayed. A restart forgets
  them, and the page asks for another tap. Sign-in and setup challenges are kept
  apart: at most 500 sign-ins can be waiting at once (more are told to wait), and a
  link has at most 3, so a flood of sign-in attempts can't push out a setup under way.
- A passkey response must come from this site's own address, exactly (`PUBLIC_URL`;
  in development, `http://localhost` on any port), and one made inside another
  site's frame is refused.
- Opening ticket links and their link previews, setup and recovery links, signing
  in and the admin password are rate-limited per visitor. An IPv6 visitor counts by
  its /64.
- The API accepts changes only as JSON (apart from the logo and tab icon you upload
  in the admin, which are sent as the image itself), and refuses them when the
  browser says they come from another site or from another subdomain of this one
  (`Sec-Fetch-Site: cross-site` or `same-site`). Browsers treat every subdomain of a
  domain as the same site, and passkeys here can belong to the parent domain, so a
  page on another subdomain mustn't be able to act for anyone.
- The app never logs ticket codes, link tokens, cookies or the admin password, and
  Caddy keeps no access log. When a passkey is refused, the reason goes to the
  server log, never to the browser. Pages send no Referer, and the page the server
  sends for a `/t/<code>` address doesn't contain the code, not even in its preview
  tags: a preview's poster has [an address of its own](#link-previews). So the code
  goes no further than the requests for that page (a ticket for one person keeps it
  in the address until they sign in). The exception: if the app is down or
  restarting when someone opens their ticket link, Caddy's error log records the
  address, code included. (A setup link's token is never in an address the server
  sees, so not even then.)

## What is recorded

Viewing:

- **opened**: the film page was loaded with a ticket (at most once per 30 minutes per browser)
- **play**: a screening started or resumed
- **heartbeat**: playback position, reported every 30 seconds while playing and
  logged every 5 minutes
- **finished**: playback reached 92% of the running time (decided on the server)

When the browser is signed in, Activity shows the person against these, read from
the session: nothing more is stored. Events from before they signed in stay
anonymous. Reading the page of a film shown to members, without a ticket, records
nothing, and nor does a link preview fetching a ticket's page or poster.

**Playback help**, the link under the player, reads the browser and the player only.
Opening it and copying its summary record nothing and send nothing. The summary
leaves out every address (they hold screening ids), cookies, ticket labels and codes,
people's names, the film's title and the cinema's name, so a viewer can send it to
you without giving any of those away.

**Audio and subtitle choices** (the languages, and the subtitles' size and background)
are remembered by the player in the viewer's own browser only, and never sent.

People and passkeys:

- **signed-in**: someone signed in with a passkey
- **signed-out**: a person signed out of a browser
- **signed-out-everywhere**: a person was signed out of every browser, by you or
  from their account page (and how many)
- **passkey-added**: a passkey was created from a setup or recovery link (which kind)
- **passkey-removed**: you removed a passkey (and how many browsers that signed out)
- **link-created**: you created a link (which kind, how long it works, whether it was
  a reset, and how many passkeys and browsers that removed)
- **link-cancelled**: you cancelled a waiting link
- **person-disabled** (and how many browsers that signed out) and **person-enabled**
- **sign-in-refused**: one of a person's passkeys was refused, because they're
  disabled or because the passkey's counter hadn't moved on

Keeping tickets:

- **ticket-kept**: a person kept a ticket from a link in their account (with the
  device)
- **ticket-given**: you gave a ticket to a person (and whether it was for anyone, or
  someone else's)
- **ticket-released**: a person's ticket left their account, because you let anyone
  with the link use it or gave it to someone else

Plus a coarse device label such as "Safari on iPhone": the browser's, or for a
passkey, the one it was added from. No IP addresses and no full user-agent strings
are stored, nor how often a link was opened (only when it first was). Viewers are
told on the film page that progress is recorded. This is operational information,
not proof that anyone watched.

**Refused media requests** aren't stored in the database. Besides a line in the
server's log, the last 50 are kept in memory for **Status** in the admin (the
projection booth): the time, status and reason, the kind of file (playlist, segment,
subtitles, artwork or other), the film and the coarse device label. They hold no IP
address, cookie, session, ticket, person or full address, and a restart forgets
them. Opening the booth records nothing.

### How long it's kept

A clean-up deletes old records about a minute after the app starts, and then once a
day. You set how long each kind is kept in the admin, under **Settings → Keeping
records**:

| What | Kept for, by default | Can be set to |
|---|---|---|
| Progress reports (**heartbeat**) | 30 days | 1 to 365 days |
| Every other event: **opened**, **play**, **finished**, and all those under People and passkeys and Keeping tickets above | 365 days | 30 to 3,650 days |
| A browser's session, once it has ended (signed out or expired) | 30 days from when it ended | 1 to 365 days |

The same card shows what the clean-up would delete right now and what it last
deleted, and **Clear now** runs it at once.

**A session lives as long as its events.** Activity finds the person and device
behind a viewing event through the browser's session, so a session that has ended is
kept, however long ago that was, while any event still names it. Nor is one deleted
while it holds a screening that can still be resumed, and a session that hasn't ended
never is. The link tickets a browser held go with its session.

**The clean-up never changes tickets or screenings.** Screening limits, **finished**,
resume positions, start-by deadlines, expiry, and when a ticket was first opened and
first played all come from those, so the clean-up changes nothing a viewer can do,
and a test checks it. The counts on a film's and a person's admin page come from
tickets and screenings too, and a person's **Last signed in** is kept with the
person, not worked out from their sessions. On the ticket list, a ticket whose events
have gone shows its latest screening as its last activity, or else when it was first
opened.

**Backups keep what they had.** A backup is the database as it was when it was
written, so the events and sessions deleted since stay in it until the backup itself
expires: by default after 14 days for a daily one and a year for a monthly one (see
[deploying.md](deploying.md#backups)). Restoring an older backup brings them back
until the clean-up runs again, about a minute after the app starts.
