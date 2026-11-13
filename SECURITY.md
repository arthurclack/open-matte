# Security

Open Matte is a small personal project, looked after in spare time. If you find a way
round its rules, please report it privately, as below, so it can be fixed before
anyone else learns of it.

## What's in scope

The rules in [docs/access.md](docs/access.md), as the code in the latest release or
the `main` branch implements them. For example:

- Playing a film, or fetching any of its playlists, segments, audio or subtitles,
  without a link (a ticket), its loan and a Play that the rules allow. A ticket for one film
  unlocking another, or a file from outside a film's folder being served.
- Using a ticket for one person without being signed in as them, or learning its film
  or its person from the link.
- Signing in as someone without their passkey, creating a passkey without a valid
  setup or recovery link, or replaying a passkey response.
- Reaching the admin without the admin password, or a person becoming an admin.
- Getting round cancelling a link, signing out, disabling a person, removing a
  passkey, taking a tape back, a tape's due-back date, one tape per film, a link
  lending once, a start-by date or "one device at a time".
- Learning who has a tape out, or anything of someone else's loan beyond "Out on loan"
  and the date it's due back, from anywhere but the back office ([Never who has
  it](docs/access.md#never-who-has-it)).
- Something the docs say isn't recorded, logged or sent turning up where it
  shouldn't: ticket codes, link tokens or cookies in logs or a Referer; an address,
  name or title in Playback help's summary; a preview poster's address that fetches
  anything but that poster; a clean-up that changes what a viewer can do.
- Requests from another site or subdomain acting for an admin or a viewer, or script
  run from an uploaded logo or icon, a `film.json`, or details fetched from TMDB.
- Markup getting into a page from any of those, even where the pages'
  Content-Security-Policy stops it doing harm; and a page the policy lets load or run
  something it shouldn't.
- A single request that does far more harm than its size: one that crashes the
  server, fills its disk, or locks people out.
- The files in `deploy/` exposing something they shouldn't, used as the docs describe.

## What isn't

These are known, and [docs/access.md](docs/access.md) says so:

- It isn't DRM. Someone who can play a film can record it, and revoking a ticket can't
  take back what's already in their player's buffer (usually under a minute).
- A ticket for anyone with the link is a bearer link: whoever has it can use it.
  Forwarding it works, by design.
- Anyone who can read the database or a backup can use the codes of tickets for anyone
  with the link, which are kept readable so you can copy a link again.
- A link preview tells the messaging app, and whoever runs its servers, which film was
  sent.
- If the app is down when someone opens a ticket link, Caddy's error log records the
  address, code included.
- A site on another name under the shop's parent domain can set cookies the
  shop receives. That's enough to stop a browser using the shop, and to give a
  browser a session of that site's choosing: browsers keep only so many cookies for
  one parent domain, so by setting enough of its own, the site can crowd the
  shop's cookie out, then set its own in its place. Ticket links opened in that
  browser then work for whoever runs the site too, until the browser next signs in.
  Only `__Host-` cookie names (planned) or a domain of the shop's own rule this
  out.
- The pages' Content-Security-Policy ([docs/access.md](docs/access.md#secrets-and-sessions))
  is a second line of defence, not the first: the pages escape what they show, and
  the policy is there for anything that slips past. It stops a page running scripts
  that aren't the app's own, loading from other sites and sending forms elsewhere.
  It can't stop the app's own scripts being misused, a browser extension, or someone
  who controls the server, and browsers too old to know it ignore it. Markup that got
  into a page would still show, and could still use what the policy allows: the shop's
  own images, fonts, stylesheets and requests; and a link or a page redirect in it
  could still take a viewer to another site, carrying what's in the link with them. A
  browser's report of something it blocked goes to the server log only.

Also out of scope: anything that needs the admin password or access to the server
already; the rest of the server it runs on (the operating system, Docker, DNS, the
firewall, other software, a weak `ADMIN_PASSWORD`); floods of traffic; reports from
a scanner with no problem shown; and a flaw in a dependency that doesn't affect Open
Matte, which belongs with that project.

Test on a shop you run yourself. Don't test against anyone else's, or with tickets
or links that weren't sent to you for the purpose.

## Reporting a problem privately

Use GitHub's private vulnerability reporting on this repository: open the
**Security** tab, then press **Report a vulnerability**. Only the repository's owner
and maintainers see the report, and you can talk it through there.

The repository's owner has to switch private vulnerability reporting on in the
repository's settings. If there's no **Report a vulnerability** button, it isn't on
yet: open an issue asking for a private way to report a security problem, and leave
every detail of the problem out of it.

Please don't put a security problem in a public issue, discussion or pull request.

## What to include

- The version you tried, shown at the foot of **Status** in the back office, or the commit.
- What you did, step by step, what happened, and what should have happened. Which rule
  in access.md it breaks, if you can say.
- What an attacker needs for it to work: nothing, a ticket link, a signed-in browser, a
  passkey, the admin password, or a place on the network.
- The browser and device, and how the server runs: with the Docker Compose and Caddy
  files in `deploy/`, or some other way.
- A proof of concept, if you have one, made against your own install.
- Whether you'd like to be credited, and by what name.

Leave out real ticket links, setup and recovery links, cookies, people's names and
your server's address. Redact them from logs and screenshots. A summary copied from
**Playback help** is fine as it is: it leaves those out already.

## What to expect

- **Best effort.** There's no security team, no fixed response time and no bounty.
  You'll get a reply once the report has been read and tried, saying whether it could
  be reproduced.
- **A fix in a new release**, for the latest version only. Its entry in
  [CHANGELOG.md](CHANGELOG.md) says what was fixed and what people running a shop
  should do, under **Security**. For anything serious there's a GitHub security
  advisory too, crediting you if you'd like.
- **Please keep it private** until the fixed release is out, or until a date agreed in
  the report.

## If it's your own shop

If you think someone has used a tape, a link or a membership card they shouldn't
have, you don't need to wait for a fix to cut them off. In the back office: take the
tape back; use **Sign out everywhere** or **Turn the card off** on a member's page,
or **Lost phone: take back the keys** if they've lost a device; and **Settings →
Sign out every friend and member** for everyone at once. If the admin password may be
known, change `ADMIN_PASSWORD` in `deploy/.env` and run `docker compose up -d` in
`/srv/open-matte/app/deploy`. A restart alone keeps the old password. The new one
signs every browser out of the back office, yours included. Then look for anything
you didn't do, since someone in the back office can add members, create setup and
recovery links, and lend tapes: check **Members** and each member's passkeys, the
links still waiting under **Status**, and the **Ledger**. Turn off the card of anyone
you didn't add, remove any passkey you don't recognise, and take back tapes you
didn't lend.
