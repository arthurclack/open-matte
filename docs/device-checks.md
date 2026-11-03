# Device checks

Does everything work on the phones, computers, browsers and TVs friends will use?
Split in two on 1 November:

- **[To close milestone 2](#to-close-milestone-2)**: the checks that test milestone 2's
  own risks. Signing in differs on every platform, and AirPlay and Chromecast receivers
  might fetch video without the phone's cookie, which would need new work.
- **[For milestone 3](#for-milestone-3)**: checks that are about playback rather than
  accounts. They join milestone 3's playback compatibility testing.

Each group says what to do and what to look for. Write what happened in its results
table; a check that fails is worth a line about what you saw, and the server log
(`docker compose logs app`) says why any media request was refused.

## Before you start

- **Reach the real address.** Passkeys only work at `https://www.openmatte.dev`
  itself, and the home gateway blocks it. Use mobile data or a phone's hotspot, or the
  hosts-file line for a computer: see [Testing from home](deploying.md#testing-from-home).
- **Never test in the browser you use for the admin.** The admin cookie bypasses every
  ticket and person rule (the site shows "Admin preview" when both are present). Use
  another browser, a private window, or sign out of the admin first.
- **Use Test Pattern.** It's a minute long: if the picture moves, the audio switches
  between English and French and the subtitles appear, playback works.
- **In the admin, prepare:**
  1. **Publish** Test Pattern (it starts as a draft, and a ticket for a draft doesn't
     open), then issue a ticket **only for you**, signed in, with no screening limit.
  2. A plain ticket **for anyone with the link** for Test Pattern, for the TV.
  3. **Show to members** on a film you have no ticket for (say Hedwig), and a ticket
     **for anyone with the link** for that film with **Let them keep it in their
     account** ticked. It has to be a film without a ticket of yours: once you're
     signed in, the page shows your own ticket, and keeping is only offered for the
     ticket the page shows.

## The checks on every device

Do these wherever a group says "the usual checks":

1. **Sign in** with a passkey (the phone's QR code where a group says so).
2. **Your tickets** lists your ticket for Test Pattern without opening its link, and
   **Showing to members** lists Hedwig, marked "No ticket yet". Hedwig's page shows
   the recommendation and no Play button.
3. **Play** Test Pattern: picture, both audio tracks, subtitles on and off, the
   quality menu. Pause, reload the page, and **Resume** carries on where it was.
4. **Your account** (under your name) lists this browser as "This browser", and the
   passkey you used as "Signed in here with this".
5. **Sign out**: the header says Sign in, and Test Pattern's page says nothing is
   showing.

## To close milestone 2

### iPhone and Mac Safari

- iPhone Safari, on mobile data: the usual checks, with Face ID. The passkey you made
  with your setup link should be there already (Synced, in iCloud Keychain).
- Mac Safari: the usual checks. The same passkey should come from iCloud Keychain, with
  Touch ID or your password.
- **Keeping**, on the Mac: open the **keepable** link (for Hedwig) in a browser that
  isn't signed in, such as Chrome: it plays with no sign-in. Then open it in a private
  Safari window, sign in there and press **Keep it**. Hedwig moves from Showing to
  members to Your tickets on the iPhone, without opening the link, and Chrome is told
  "This ticket has been kept".

### Signing in with the phone's QR code

- Chrome on Windows: Windows Hello won't know an iCloud passkey, so sign in with
  **Use a phone or tablet** and the iPhone's camera (Bluetooth must be on, on both).
  Then the usual checks from step 2.
- No Windows computer to hand? Chrome on the Mac does the same if you choose **Use a
  phone or tablet** instead of the passkey Chrome offers from iCloud Keychain.

### Android and a password manager

- Android Chrome: the usual checks, signing in with the iPhone's QR code, or with an
  **Add a sign-in method** link from your person page (which makes a passkey in Google
  Password Manager). Try playback on mobile data.
- A password manager (1Password or Bitwarden, say): with its browser extension on,
  open an **Add a sign-in method** link from your person page and let the password
  manager save the passkey. Sign out, then sign in with it. Your account should show
  it as a second passkey, added with a recovery link.
- Optional: a security key, the same way.

### In-app browsers

Send yourself both Test Pattern links (the one only for you, and the plain one for
anyone) in WhatsApp and in an Instagram message, and open each from inside the app.

- **The link for anyone** should play in the app's own browser.
- **The link only for you** either works (some apps open links in a Safari or Chrome
  view that has your passkeys) or shows **Open this in Safari or Chrome** with **Copy
  ticket link**. Either is fine; what matters is that pasting the copied link into
  Safari or Chrome opens the ticket.
- Note which apps did which: it tells friends what to expect.

### AirPlay and Chromecast

- **AirPlay** from the iPhone, signed in, to an Apple TV or an AirPlay TV: start Test
  Pattern, then AirPlay it. Does the picture carry on, with sound?
- **Chromecast** from Android Chrome (or Chrome on the Mac), signed in: cast the tab,
  or the video if Chrome offers it. Does it play?
- If the receiver stops after a few seconds, look for `media 403` in the server log
  with a device like "Apple media player" or a cast receiver: it means the receiver
  fetches the video itself, without the phone's cookie. That's the case milestone 2's
  plan set aside for separate work (screening-bound media addresses), not a reason to
  loosen the media check.

### Results: milestone 2

| Where | Signed in | Your tickets, member film | Plays (audio, subtitles, quality) | Account page, sign out | Notes |
|---|---|---|---|---|---|
| iPhone Safari | Yes: passkey created with the setup link, 27 Oct | Yes (reported) | Yes, 27 Oct: Play and Resume on the ticket for you, no media errors | Not yet | Synced passkey (iCloud Keychain) |
| Mac Safari | Yes, 27 Oct, with the iPhone's synced passkey from iCloud Keychain; a private window carried its link ticket into the account | Your ticket's page, signed in | Yes, 27 Oct, from a link ticket with no sign-in | Not yet | Keeping: not yet (the Hedwig ticket) |
| Chrome, signed in with the QR code (Windows or Mac) | | | | | |
| Android Chrome | | | | | |
| Password manager | | | | | |
| Security key (optional) | | | | | |
| WhatsApp in-app | – | – | | – | |
| Instagram in-app | – | – | | – | |
| AirPlay from iPhone | – | – | | – | |
| Chromecast | – | – | | – | |

Milestone 2 is done when every row but the security key has a result, and AirPlay and
Chromecast either play or are written up as their own work.

## For milestone 3

Playback checks, folded into milestone 3's compatibility testing with milestone 1's
open ones. They use the same setup and the plain Test Pattern link for anyone.

- **A TV's own browser**: open the plain link for anyone (type it, or send it in a
  message the TV can open). It should play. The link only for you shows a sign-in page
  the TV probably can't complete: that's expected, and why TVs get tickets for anyone.
- **Desktop Firefox**: the usual checks. Firefox can use the passkeys the computer
  keeps, or the phone's QR code. Playback goes through hls.js: try the quality menu.
- **Chrome on Mac and Windows playback**: the quality menu and audio switching through
  hls.js, if the QR-code checks above didn't already cover them.
- **Non-HDR screen**: play a film with HDR renditions on an ordinary (SDR) monitor or
  TV. The picture should look natural, not grey or washed out.
- **Keyboard only, Mac Safari**: turn on Safari ▸ Settings ▸ Advanced ▸ "Press Tab to
  highlight each item" (Safari skips links otherwise). Tab to Play, press Return, then
  Space pauses and the arrow keys seek. The name menu opens with Return and closes
  with Escape. (Checked in Chromium on 27 October.)

### Branding and link previews

Once slice 1 is deployed, with colours, a logo and a tab icon set in **Settings ▸
Branding**:

- **Every viewer page**, on the iPhone and the Mac: the colours from the first moment
  (no flash of amber), the logo and name in the header with the page rather than a moment
  later, the tab icon. On the iPhone, the logo and name shouldn't crowd the Sign in link.
- **Link previews**: paste a ticket link into a WhatsApp chat and an iMessage, and let
  the preview appear before sending. The plain link **for anyone** should show Test
  Pattern's poster and title. The link **only for you** should show only the cinema's
  name and logo. Neither counts as opening the ticket: in the admin, the ticket isn't
  marked opened and Activity shows nothing new. Where the app lets you copy the preview
  picture's address, it should start `/poster/` and hold no ticket code.
- A preview is made once and kept by the app, so check with a ticket that has never been
  pasted anywhere.

### Results: milestone 3

| Where | Plays (audio, subtitles, quality) | Notes |
|---|---|---|
| TV browser (link for anyone) | | |
| Desktop Firefox | | |
| Chrome on Mac and Windows | | |
| Non-HDR screen | | |
| Mac Safari, keyboard only | | Chromium checked 27 Oct: Play, Space, menu |
| Branding, iPhone and Mac Safari | – | |
| WhatsApp preview (for anyone / only for you) | – | |
| iMessage preview (for anyone / only for you) | – | |
