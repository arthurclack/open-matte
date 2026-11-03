// Ticket → play: a ticket link for anyone, opened in a fresh browser, plays the
// film; the bar switches audio and subtitles; Playback help's summary holds no
// address, ticket code, film title or cinema name. Every browser; the playback
// part skips where the browser can't decode H.264 and AAC.
import { admin, audioHeard, cinemaName, expect, film, heartbeats, media, playButton, playbackSupport, test, unique } from './fixtures.js';

test('a ticket link plays the film, switches audio and subtitles, and Playback help leaves out what it should', async ({ page }, testInfo) => {
  const label = unique('Playback', testInfo);
  const ticket = await admin.issueTicket({ label });
  const reports = heartbeats(page);
  const heard = audioHeard(page);

  await test.step('the link opens the film page, and the code leaves the address', async () => {
    await page.goto(`/t/${ticket.code}`);
    await expect(page).toHaveURL((url) => url.pathname === `/${film.slug}`);
    expect(page.url()).not.toContain(ticket.code);
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(playButton(page)).toHaveText('▶ Play');
  });

  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);

  await test.step('Play starts the film, and a progress report is accepted', async () => {
    await playButton(page).click();
    await media.playedPast(page, 2);
    await expect.poll(() => reports.filter((r) => r.status === 200).length, { message: 'an accepted heartbeat' }).toBeGreaterThan(0);
    expect(reports.filter((r) => r.status !== 200)).toEqual([]);
  });

  await test.step('the lock screen and media controls show the film', async () => {
    const session = await media.session(page);
    if (session.supported) expect(session.metadata).toEqual({ title: film.title, artist: cinemaName() });
    else testInfo.annotations.push({ type: 'skipped check', description: 'no Media Session in this browser' });
  });

  await test.step('French audio from the bar', async () => {
    const engine = await media.engine(page);
    testInfo.annotations.push({ type: 'player', description: engine === 'hls' ? 'hls.js' : "the browser's own HLS player" });
    const audio = page.getByLabel('Audio');
    // Each with the channel layout the encoder recorded.
    await expect(audio.locator('option')).toHaveText(['English · Stereo', 'French · Stereo']);
    await expect(audio.locator('option:checked')).toHaveText('English · Stereo');
    const since = heard.mark();
    await audio.selectOption({ label: 'French · Stereo' });
    await heard.is({ language: 'fr', rendition: 'a_fr_1', since });
    await expect(audio.locator('option:checked')).toHaveText('French · Stereo');
  });

  await test.step('French subtitles from the bar', async () => {
    const subtitles = page.getByLabel('Subtitles');
    // The forced track is never in the menu.
    await expect(subtitles.locator('option')).toHaveText([/^Off/, 'English', 'French']);
    await subtitles.selectOption({ label: 'French' });
    // Only one track ever shows: the forced one goes when French is chosen.
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French showing', 'French (forced) disabled']);
    await expect.poll(() => media.shownCue(page)).toBe(film.cues[1]);
  });

  await test.step('Playback help: a summary with no address, code, title or name', async () => {
    await page.getByRole('button', { name: 'Playback help' }).click();
    const panel = page.getByRole('region', { name: 'Playback help' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Copy summary' }).click();
    // On the clipboard, or in the text box the panel offers when it can't copy.
    const copied = () => page.evaluate(() => window.__copied ?? document.querySelector('.playback-help textarea')?.value ?? null);
    await expect.poll(copied).not.toBeNull();
    const summary = await copied();
    await testInfo.attach('playback-summary.txt', { body: summary, contentType: 'text/plain' });

    expect(summary).toMatch(/^Playback summary\n/);
    expect(summary).toContain('\nAudio: French · Stereo\n');
    expect(summary).toContain('\nSubtitles: French\n');
    for (const text of [await panel.innerText(), summary]) {
      expect(text).not.toMatch(/https?:|blob:|data:|localhost|\/media\/|\/t\//i);
      for (const secret of [ticket.code, film.title, film.slug, cinemaName(), label]) expect(text).not.toContain(secret);
    }
  });
});
