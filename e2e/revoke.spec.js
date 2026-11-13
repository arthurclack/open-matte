// Take it back: while its film plays, the owner takes the tape back from the film's
// page in the back office, which asks first, on the page, and says what the borrower
// will see. The player stops at the next request it makes and says who took it back,
// the page is gone as a cancelled link's is, a media request from that browser is
// refused, the lock screen forgets the film, and the link is cancelled. Every browser;
// skips where the browser can't decode H.264 and AAC, since it needs the film playing.
//
// (1.x: the progress report was answered 404, and the player might say "This tape is
// no longer valid". Version 2 decides by the loan first, so the borrower is told
// "taken back": docs/version-2.md, "What can happen to a tape". 1.x's second journey
// here, a play given back mid-film, went with Give back: a loan's playback can't be.)
import { admin, asAdmin, expect, film, heartbeats, media, playbackSupport, test, unique } from './fixtures.js';

// What the player says when the tape is taken back, wherever it hears of it: from its
// progress report, or from a playlist or segment refused first (it then asks why).
const TAKEN_BACK = /has taken this tape back\.$/;

test('taking a tape back mid-film stops the player, which says so, and refuses its media', async ({ page, newContext }, testInfo) => {
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

  await test.step('the owner takes the tape back on the film’s page, which asks first', async () => {
    // The back office in a browser of its own: the friend's is never signed in to it.
    const office = await newContext();
    await asAdmin(office);
    const desk = await office.newPage();
    await desk.goto(`/admin/films/${film.id}`);
    const tape = desk.getByRole('region', { name: 'The tape' });
    await expect(tape).toContainText('Out to a browser, from a link anyone can use');
    await expect(tape).toContainText(`Your note: ${ticket.label}`);
    await tape.getByRole('button', { name: 'Take the tape back' }).click();
    const question = tape.getByRole('group', { name: `Take ${film.title} back from that browser?` });
    await expect(question).toBeVisible();
    await expect(question).toContainText("It's back in straight away, and that browser's link stops working, as cancelling it would.");
    await expect(question).toContainText('has taken this tape back.” Its page for the film then says “Nothing on the shelf here”, as for a cancelled link.');
    // Keep it out changes nothing, and gives the focus back to the button.
    await question.getByRole('button', { name: 'Keep it out' }).click();
    await expect(tape.getByRole('button', { name: 'Take the tape back' })).toBeFocused();
    expect((await admin.get(`/api/admin/tickets/${ticket.id}`)).linkState).toBe('has');

    await tape.getByRole('button', { name: 'Take the tape back' }).click();
    const taken = desk.waitForResponse((r) => /^\/api\/admin\/loans\/\d+\/take-back$/.test(new URL(r.url()).pathname));
    await question.getByRole('button', { name: 'Take it back' }).click();
    expect((await taken).status()).toBe(200);
    await expect(desk.getByRole('status').filter({ hasText: `${film.title} is back in.` })).toHaveText(
      `${film.title} is back in. You took it back from that browser, and the link it was out on is cancelled.`,
    );
    await expect(desk.locator('.of-tape__state')).toHaveText('In');
    expect((await admin.get(`/api/admin/tickets/${ticket.id}`)).linkState).toBe('cancelled');
  });

  await test.step('the next request the player makes is refused, and it says who took the tape back', async () => {
    // The next progress report would come within 30 seconds; pausing sends one
    // at once, as a viewer pausing would. (If the film already ended, playing
    // it again does the same; if the player has already heard, from a request for
    // more of the film, there is no video left to press.)
    await page.locator('video').evaluateAll((videos) => {
      for (const v of videos) {
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      }
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
