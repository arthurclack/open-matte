# Tickets, people and screenings

The goal is "private enough for friends", not DRM. These are the rules the code
follows: `server/access.js` implements the ticket rules, `server/people.js` and
`server/webauthn.js` people and passkeys, and the tests in `test/` check them.

Milestone 2 is being built in slices, planned in [milestone-2.md](milestone-2.md).
So far it adds people and passkeys, which on their own grant nothing: a signed-in
person watches with a ticket link exactly as anyone else does. Tickets that only one
person can use, keeping a ticket in an account, films shown to members and an
account page are planned there, not built yet.

## The records

| Record | What it is | Created when |
|---|---|---|
| **Ticket** | An "admit one" invitation to one film, with its own link | The admin issues it |
| **Session** | A browser's sign-in, held in an HttpOnly cookie | Someone opens a ticket link, or signs in with a passkey |
| **Screening** | One use of a ticket | Someone presses Play |
| **Person** | Someone you've added, who can sign in | You add them |
| **Passkey** | A person's sign-in key, kept by their phone, computer or password manager | They create it from a link you sent |
| **Setup or recovery link** | A single-use link for creating a passkey | You create it for one person |

## Tickets

A ticket is a **bearer invitation**: whoever has the link can use it. The name you
give it is a label for you, not an identity check, and signing in doesn't change
that. (Tickets that only one signed-in person can use are planned in
[milestone-2.md](milestone-2.md).)

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
| The device playing can no longer play: it was signed out (by its viewer or by you), its session expired, its person was disabled, or **Sign out browsers** took the ticket out of it | Another device can take the screening over at once, without waiting. This covers link tickets too, for example after **Sign out every viewer**. |
| Reach the limit | No new screenings; an open one can still be resumed. |
| Revoke the ticket | Page and media requests fail from the next request on. |
| Unpublish the film | The page disappears and playback under way stops, for every ticket. Publishing again restores both; open screenings keep their place, and their resume windows keep running meanwhile. |
| The film's folder goes missing, or a scan finds errors in it | The page stays and says the film isn't available right now; nothing plays and no screening can start. Resume windows keep running meanwhile. |

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
pressing Play. A ticket for one film unlocks nothing of another, and a file in a
film folder that is really a symlink to somewhere outside it is never served.
Media responses are marked `private`, so only the viewer's own browser caches them.
Revoking a ticket, signing a browser out, disabling a person or removing a passkey
stops future requests, playlists and segments included; none of them can take back
what is already in the player's buffer (typically under a minute of video).

A browser signed in to the admin plays in preview mode and never uses a screening.

## People and passkeys

A **person** is someone you've added in the admin under **People**. Nobody can sign
up on their own, and nobody needs an account to watch: ticket links work for
anyone, in any browser, TVs included.

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
Safari or Chrome.

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

You can sign people out too (below). Whichever way a browser is signed out, it
forgets the link tickets it opened, and a screening it held is freed at once.

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
  like anyone else they can still watch with a ticket link, by opening it again.
- **Enable** lets them sign in again with the passkeys they have. A link that
  disabling cancelled stays cancelled.
- **Sign out everywhere** signs the person out of every browser. Their passkeys still
  work.
- **Remove** a passkey: it stops working at once, and the browsers it signed in are
  signed out. Their other passkeys, and the browsers those signed in, are
  unaffected. The passkey stays in their password manager, but is refused here.
  Removed passkeys are deleted; Activity keeps the device they were added from.

## Secrets and sessions

- Ticket codes are about 64 random bits. They're stored as they are, so the admin
  can copy a link again later; anyone who can read the database could use them.
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
- Opening ticket links, setup and recovery links, signing in and the admin password
  are rate-limited per visitor. An IPv6 visitor counts by its /64.
- The API accepts changes only as JSON, and refuses them when the browser says they
  come from another site or from another subdomain of this one
  (`Sec-Fetch-Site: cross-site` or `same-site`). Browsers treat every subdomain of a
  domain as the same site, and passkeys here can belong to the parent domain, so a
  page on another subdomain mustn't be able to act for anyone.
- The app never logs ticket codes, link tokens, cookies or the admin password, and
  Caddy keeps no access log. When a passkey is refused, the reason goes to the
  server log, never to the browser. Pages send no Referer, so the code in a
  `/t/<code>` address goes no further than that one request. The exception: if the
  app is down or restarting when someone opens their ticket link, Caddy's error log
  records the address, code included. (A setup link's token is never in an address
  the server sees, so not even then.)

## What is recorded

Viewing:

- **opened**: the film page was loaded with a ticket (at most once per 30 minutes per browser)
- **play**: a screening started or resumed
- **heartbeat**: playback position, reported every 30 seconds while playing and
  logged every 5 minutes
- **finished**: playback reached 92% of the running time (decided on the server)

When the browser is signed in, Activity shows the person against these, read from
the session: nothing more is stored. Events from before they signed in stay
anonymous.

People and passkeys:

- **signed-in**: someone signed in with a passkey
- **signed-out**: a person signed out of a browser
- **signed-out-everywhere**: you signed a person out of every browser (and how many)
- **passkey-added**: a passkey was created from a setup or recovery link (which kind)
- **passkey-removed**: you removed a passkey (and how many browsers that signed out)
- **link-created**: you created a link (which kind, how long it works, whether it was
  a reset, and how many passkeys and browsers that removed)
- **link-cancelled**: you cancelled a waiting link
- **person-disabled** (and how many browsers that signed out) and **person-enabled**
- **sign-in-refused**: one of a person's passkeys was refused, because they're
  disabled or because the passkey's counter hadn't moved on

Plus a coarse device label such as "Safari on iPhone": the browser's, or for a
passkey, the one it was added from. No IP addresses and no full user-agent strings
are stored, nor how often a link was opened (only when it first was). Viewers are
told on the film page that progress is recorded. This is operational information,
not proof that anyone watched.
