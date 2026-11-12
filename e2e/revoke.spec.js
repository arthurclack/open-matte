// Take it back: cancelling the link that has the tape, while its film plays, takes
// the tape back. The player stops at the next request it makes and says who took it
// back, the page is gone as a cancelled link's is, a media request from that browser
// is refused, and the lock screen forgets the film. Every browser; skips where the
// browser can't decode H.264 and AAC, since it needs the film playing.
//
// (1.x: the progress report was answered 404, and the player might say "This tape is
// no longer valid". Version 2 decides by the loan first, so the borrower is told
// "taken back": docs/version-2.md, "What can happen to a tape". 1.x's second journey
// here, a play given back mid-film, went with Give back: a loan's playback can't be.)
import { admin, expect, film, heartbeats, media, playbackSupport, test, unique } from './fixtures.js';

// What the player says when the tape is taken back, wherever it hears of it: from its
// progress report, or from a playlist or segment refused first (it then asks why).
const TAKEN_BACK = /has taken this tape back\.$/;

test('taking a tape back mid-film stops the player, which says so, and refuses its media', async ({ page }, testInfo) => {
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

  await test.step('the owner cancels the link, which takes the tape back, and the next request the player makes is refused', async () => {
    const cancelled = await admin.revoke(ticket.id);
    expect(cancelled.tookBack).toBe(true);
    // The next progress report would come within 30 seconds; pausing sends one
    // at once, as a viewer pausing would. (If the film already ended, playing
    // it again does the same.)
    await page.locator('video').evaluate((v) => {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    });
    await expect.poll(() => reports.filter((r) => r.status !== 200).map((r) => r.status)).toContain(409);
    await expect.poll(() => page.evaluate(() => window.__playerMessages), { message: 'the player says why it stopped' }).toContainEqual(
      expect.stringMatching(TAKEN_BACK),
    );
    expect(await page.evaluate(() => window.__playerMessages)).not.toContainEqual(expect.stringMatching(/no longer valid|no longer allowed/));
    // Then the film page asks again, and the link is gone from this browser.
    await expect(page.getByRole('heading', { name: 'Nothing on the shelf here' })).toBeVisible();
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
