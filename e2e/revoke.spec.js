// Revoke → refused: a ticket revoked while its film plays stops the player at
// the next request it makes, a media request from that browser is refused, and
// the lock screen forgets the film. Every browser; skips where the browser
// can't decode H.264 and AAC, since it needs the film playing.
import { admin, expect, film, heartbeats, media, playbackSupport, test, unique } from './fixtures.js';

// What the player says when the server refuses it: the ticket is gone (a
// progress report), or the media itself (a playlist or segment).
const STOPPED = /This ticket is no longer valid\.|Playback stopped: this browser is no longer allowed to stream this film\./;

test('revoking a ticket mid-film stops the player and refuses its media', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Revoke', testInfo) });
  const reports = heartbeats(page);

  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);

  const started = page.waitForResponse((r) => r.url().endsWith(`/api/films/${film.slug}/screenings`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Play/ }).click();
  const { masterUrl } = await (await started).json();
  expect(masterUrl).toMatch(new RegExp(`^/media/${film.slug}/`));
  await media.playedPast(page, 1);
  await expect.poll(() => reports.filter((r) => r.status === 200).length).toBeGreaterThan(0);
  const before = await media.session(page);
  if (before.supported) expect(before.metadata?.title).toBe(film.title);

  await test.step('the admin revokes it, and the next request the player makes is refused', async () => {
    await admin.revoke(ticket.id);
    // The next progress report would come within 30 seconds; pausing sends one
    // at once, as a viewer pausing would. (If the film already ended, playing
    // it again does the same.)
    await page.locator('video').evaluate((v) => {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    });
    await expect.poll(() => reports.filter((r) => r.status !== 200).map((r) => r.status)).toContain(404);
    await expect.poll(() => page.evaluate(() => window.__playerMessages), { message: 'the player says why it stopped' }).toContainEqual(
      expect.stringMatching(STOPPED),
    );
    // Then the film page asks again, and the ticket is gone from this browser.
    await expect(page.getByRole('heading', { name: 'Nothing showing here' })).toBeVisible();
  });

  await test.step('a media request from this browser now gets 403', async () => {
    const status = await page.evaluate((url) => fetch(url).then((r) => r.status), masterUrl);
    expect(status).toBe(403);
  });

  await test.step('the lock screen and media controls forget the film', async () => {
    const after = await media.session(page);
    if (!after.supported) testInfo.annotations.push({ type: 'skipped check', description: 'no Media Session in this browser' });
    else expect(after.metadata).toBeNull();
  });
});
