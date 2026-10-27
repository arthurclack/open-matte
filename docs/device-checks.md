# Device checks

Milestone 2's last slice, and milestone 1's open checks: does everything work on the
phones, computers, browsers and TVs friends will use? Each group below says what to
do and what to look for. Write what happened in [Results](#results); a check that
fails is worth a line about what you saw, and the server log
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
  2. A ticket **for anyone with the link** for Test Pattern, with **Let them keep it in
     their account** ticked, and a second plain one for the TV.
  3. **Show to members** on a film you have no ticket for (say Hedwig).

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

## iPhone and Mac Safari

- iPhone Safari, on mobile data: the usual checks, with Face ID. The passkey you made
  with your setup link should be there already (Synced, in iCloud Keychain).
- Mac Safari: the usual checks. The same passkey should come from iCloud Keychain, with
  Touch ID or your password.
- On the Mac, also open the **for anyone** link in a private window: it plays with no
  sign-in. Then sign in there and press **Keep it**; the ticket appears under Your
  tickets on the iPhone without opening the link, and a second private window that
  opened the link first is told "This ticket has been kept".
- **Keyboard only**, Mac Safari: turn on Safari ▸ Settings ▸ Advanced ▸ "Press Tab to
  highlight each item" (Safari skips links otherwise). Tab to Play, press Return, then
  Space pauses and the arrow keys seek. The name menu opens with Return and closes
  with Escape. (Checked in Chromium on 27 October.)

## Chrome on Mac and Windows

- Chrome on Mac: the usual checks. Chrome may offer the iCloud Keychain passkey
  directly; if not, choose **Use a phone or tablet** and scan the QR code with the
  iPhone. Both should work.
- Chrome on Windows: Windows Hello won't know an iCloud passkey, so sign in with
  **Use a phone or tablet** and the iPhone's camera (Bluetooth must be on, on both).
  Then the usual checks from step 2. Playback here goes through hls.js: try the quality
  menu.

## Android, desktop Firefox and a password manager

- Android Chrome: the usual checks, signing in with the iPhone's QR code, or with an
  **Add a sign-in method** link from your person page (which makes a passkey in Google
  Password Manager). Try playback on mobile data.
- Desktop Firefox: the usual checks. Firefox can use the passkeys the computer keeps,
  or the phone's QR code. Playback goes through hls.js.
- A password manager (1Password or Bitwarden, say): with its browser extension on,
  open an **Add a sign-in method** link from your person page and let the password
  manager save the passkey. Sign out, then sign in with it. Your account should show
  it as a second passkey, added with a recovery link.
- A security key, if you have one: the same, with the key.

## In-app browsers

Send yourself both links (the one only for you, and the one for anyone) in WhatsApp
and in an Instagram message, and open each from inside the app.

- **The link for anyone** should play in the app's own browser.
- **The link only for you** either works (some apps open links in a Safari or Chrome
  view that has your passkeys) or shows **Open this in Safari or Chrome** with **Copy
  ticket link**. Either is fine; what matters is that pasting the copied link into
  Safari or Chrome opens the ticket.
- Note which apps did which: it tells friends what to expect.

## TV browser, AirPlay and Chromecast

- **A TV's own browser**: open the plain link for anyone (type it, or send it in a
  message the TV can open). It should play. The link only for you shows a sign-in page
  the TV probably can't complete: that's expected, and why TVs get tickets for anyone.
- **AirPlay** from the iPhone, signed in, to an Apple TV or AirPlay speaker-TV: start
  Test Pattern, then AirPlay it. Does the picture carry on, with sound?
- **Chromecast** from Android Chrome (or Chrome on the Mac), signed in: cast the tab,
  or the video if Chrome offers it. Does it play?
- If the receiver stops after a few seconds, look for `media 403` in the server log
  with a device like "Apple media player" or a cast receiver: it means the receiver
  fetches the video itself, without the phone's cookie. That's the case milestone 2's
  plan set aside for separate work (screening-bound media addresses), not a reason to
  loosen the media check.

## Milestone 1's open checks

- **Non-HDR screen**: play a film with HDR renditions on an ordinary (SDR) monitor or
  TV. The picture should look natural, not grey or washed out.
- Android, desktop Firefox and keyboard only are covered above.

## Results

| Where | Signed in | Your tickets, member film | Plays (audio, subtitles, quality) | Account page, sign out | Notes |
|---|---|---|---|---|---|
| iPhone Safari | Yes: passkey created with the setup link, 27 Oct | Yes (reported) | Yes, 27 Oct: Play and Resume on the ticket for you, no media errors | Not yet | Synced passkey (iCloud Keychain) |
| Mac Safari | Yes, 27 Oct, with the iPhone's synced passkey from iCloud Keychain | | Not yet | Not yet | |
| Mac Safari, keyboard only | – | – | | – | Chromium checked 27 Oct: Play, Space, menu |
| Chrome on Mac | | | | | |
| Chrome on Windows (QR code) | | | | | |
| Android Chrome | | | | | |
| Desktop Firefox | | | | | |
| Password manager | | | | | |
| Security key (optional) | | | | | |
| WhatsApp in-app | – | – | | – | |
| Instagram in-app | – | – | | – | |
| TV browser (link for anyone) | – | – | | – | |
| AirPlay from iPhone | – | – | | – | |
| Chromecast | – | – | | – | |
| Non-HDR screen | – | – | | – | |
