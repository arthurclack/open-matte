// One member, two devices: a member pauses their film on one device, carries on with
// it on another, and the first then asks for something it hasn't fetched yet (the
// French audio) while still paused. The server refuses that request; the player asks
// it why, and says the film is playing on another device, with Watch here instead
// (which takes it back) rather than "no longer allowed" and Playback help. Wherever
// the player runs on hls.js: Safari's own player fetches the other audio itself and
// doesn't tell the page that a request was refused.
//
// (1.x: two browsers on one link anyone can use. In version 2 the borrower there is the
// browser that pressed Play, and a second browser on the link sees the tape out; one
// member's own devices still take over from each other. docs/version-2.md, question 12.)
import { admin, anotherDevice, expect, film, heartbeats, media, playButton, playbackSupport, signedInPerson, test, unique } from './fixtures.js';

const ELSEWHERE = 'This tape is now playing on another device.';
const FORBIDDEN = 'Playback stopped: this browser is no longer allowed to stream this film.';

test('a request refused after a member’s other device takes over says so, and Watch here instead takes it back', async ({ page, context, newContext }, testInfo) => {
  const { person, cookie, auth } = await signedInPerson(unique('Tess', testInfo));
  await context.addCookies([cookie]);
  await admin.issueTicket({ label: unique('Takeover', testInfo), personId: person.id });
  const reports = heartbeats(page);
  const refused = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (res.status() === 403 && pathname.startsWith('/media/')) refused.push(pathname);
  });

  await page.goto(`/${film.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);

  await playButton(page).click();
  await media.playedPast(page, 1);
  test.skip((await media.engine(page)) !== 'hls', "the browser's own HLS player fetches the other audio itself and doesn't say when a request is refused");

  await test.step('this device pauses, so the play is free to be taken over', async () => {
    await page.locator('video').evaluate((v) => v.pause());
    await expect.poll(() => reports.some((r) => r.status === 200 && r.playing === false), { message: 'the pause is reported' }).toBe(true);
  });

  // Their other device: signed in with the same passkey, a session of its own.
  const otherContext = await newContext();
  await otherContext.addCookies([await anotherDevice(auth)]);
  const other = await otherContext.newPage();
  const otherReports = heartbeats(other);
  await test.step('their other device opens the film, which is theirs there too, carries on with it, then pauses', async () => {
    await other.goto(`/${film.slug}`);
    await expect(playButton(other)).toHaveAccessibleName(/^Resume/);
    await playButton(other).click();
    await media.playedPast(other, 0.5);
    await other.locator('video').evaluate((v) => v.pause());
    await expect.poll(() => otherReports.some((r) => r.status === 200 && r.playing === false), { message: "the other browser's pause is reported" }).toBe(true);
  });

  await test.step('this device, still paused, picks French audio: refused, and told why', async () => {
    // Paused, the choices are on the machine's strip under the picture.
    await page.getByRole('radiogroup', { name: 'Audio' }).getByRole('radio', { name: 'French · Stereo' }).click();
    await expect.poll(() => page.evaluate(() => window.__playerMessages), { message: 'the player says why it stopped' }).toContain(ELSEWHERE);
    // The audio's playlist was refused, and the player asked the server, which said why.
    expect(refused.length, 'a media request refused with 403').toBeGreaterThan(0);
    expect(reports.map((r) => r.status)).toContain(409);
    expect(await page.evaluate(() => window.__playerMessages)).not.toContain(FORBIDDEN);
    const message = page.locator('.player-message');
    await expect(message.getByRole('button', { name: 'Watch here instead' })).toBeVisible();
    await expect(message.getByRole('button', { name: 'Playback help' })).toHaveCount(0);
  });

  await test.step('Watch here instead takes the play back, and the other device is told', async () => {
    await page.locator('.player-message').getByRole('button', { name: 'Watch here instead' }).click();
    await expect(page.locator('.player-message')).toHaveCount(0);
    await media.playedPast(page, 0.5);
    await other.locator('video').evaluate((v) => v.play().catch(() => {}));
    await expect.poll(() => other.evaluate(() => window.__playerMessages), { message: 'the other device says why it stopped' }).toContain(ELSEWHERE);
  });
});
