// Takeover → refused: a browser pauses a film, another browser opening the same
// link takes the screening over, and the first then asks for something it hasn't
// fetched yet (the French audio) while still paused. The server refuses that
// request; the player asks it why, and says the film is playing on another device,
// with Watch here instead (which takes it back) rather than "no longer allowed" and
// Playback help. Wherever the player runs on hls.js: Safari's own player fetches the
// other audio itself and doesn't tell the page that a request was refused.
import { admin, expect, film, heartbeats, media, playButton, playbackSupport, test, unique } from './fixtures.js';

const ELSEWHERE = 'This screening is now playing on another device.';
const FORBIDDEN = 'Playback stopped: this browser is no longer allowed to stream this film.';

test('a request refused after a takeover says another device has the screening, and Watch here instead takes it back', async ({ page, newContext }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Takeover', testInfo) });
  const reports = heartbeats(page);
  const refused = [];
  page.on('response', (res) => {
    const { pathname } = new URL(res.url());
    if (res.status() === 403 && pathname.startsWith('/media/')) refused.push(pathname);
  });

  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);

  await playButton(page).click();
  await media.playedPast(page, 1);
  test.skip((await media.engine(page)) !== 'hls', "the browser's own HLS player fetches the other audio itself and doesn't say when a request is refused");

  await test.step('this browser pauses, so the screening is free to be taken over', async () => {
    await page.locator('video').evaluate((v) => v.pause());
    await expect.poll(() => reports.some((r) => r.status === 200 && r.playing === false), { message: 'the pause is reported' }).toBe(true);
  });

  const other = await (await newContext()).newPage();
  const otherReports = heartbeats(other);
  await test.step('another browser opens the link and resumes the screening, then pauses', async () => {
    await other.goto(`/t/${ticket.code}`);
    await expect(playButton(other)).toHaveText(/^Resume/);
    await playButton(other).click();
    await media.playedPast(other, 0.5);
    await other.locator('video').evaluate((v) => v.pause());
    await expect.poll(() => otherReports.some((r) => r.status === 200 && r.playing === false), { message: "the other browser's pause is reported" }).toBe(true);
  });

  await test.step('this browser, still paused, picks French audio: refused, and told why', async () => {
    await page.getByLabel('Audio').selectOption({ label: 'French · Stereo' });
    await expect.poll(() => page.evaluate(() => window.__playerMessages), { message: 'the player says why it stopped' }).toContain(ELSEWHERE);
    // The audio's playlist was refused, and the player asked the server, which said why.
    expect(refused.length, 'a media request refused with 403').toBeGreaterThan(0);
    expect(reports.map((r) => r.status)).toContain(409);
    expect(await page.evaluate(() => window.__playerMessages)).not.toContain(FORBIDDEN);
    const message = page.locator('.player-message');
    await expect(message.getByRole('button', { name: 'Watch here instead' })).toBeVisible();
    await expect(message.getByRole('button', { name: 'Playback help' })).toHaveCount(0);
  });

  await test.step('Watch here instead takes the screening back, and the other browser is told', async () => {
    await page.locator('.player-message').getByRole('button', { name: 'Watch here instead' }).click();
    await expect(page.locator('.player-message')).toHaveCount(0);
    await media.playedPast(page, 0.5);
    await other.locator('video').evaluate((v) => v.play().catch(() => {}));
    await expect.poll(() => other.evaluate(() => window.__playerMessages), { message: 'the other browser says why it stopped' }).toContain(ELSEWHERE);
  });
});
