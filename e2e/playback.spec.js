// Ticket → play: a ticket link for anyone, opened in a fresh browser, plays the
// film; the bar switches audio and subtitles; Playback help's summary holds no
// address, ticket code, film title or cinema name. Every browser; the playback
// part skips where the browser can't decode H.264 and AAC.
import { admin, cinemaName, expect, film, heartbeats, media, playbackSupport, test, unique } from './fixtures.js';

test('a ticket link plays the film, switches audio and subtitles, and Playback help leaves out what it should', async ({ page }, testInfo) => {
  const label = unique('Playback', testInfo);
  const ticket = await admin.issueTicket({ label });
  const reports = heartbeats(page);

  await test.step('the link opens the film page, and the code leaves the address', async () => {
    await page.goto(`/t/${ticket.code}`);
    await expect(page).toHaveURL((url) => url.pathname === `/${film.slug}`);
    expect(page.url()).not.toContain(ticket.code);
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
  });

  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);

  await test.step('Play starts the film, and a progress report is accepted', async () => {
    await page.getByRole('button', { name: /Play/ }).click();
    await media.playedPast(page, 2);
    await expect.poll(() => reports.filter((r) => r.status === 200).length, { message: 'an accepted heartbeat' }).toBeGreaterThan(0);
    expect(reports.filter((r) => r.status !== 200)).toEqual([]);
  });

  await test.step('the lock screen and media controls show the film', async () => {
    const session = await media.session(page);
    if (session.supported) expect(session.metadata).toEqual({ title: film.title, artist: cinemaName() });
  });

  await test.step('French audio from the bar', async () => {
    const engine = await media.engine(page);
    testInfo.annotations.push({ type: 'player', description: engine === 'hls' ? 'hls.js' : "the browser's own HLS player" });
    const audio = page.getByLabel('Audio');
    await expect(audio.locator('option')).toHaveText(['English', 'French']);
    if (engine === 'hls') {
      // hls.js fetches the French rendition once it's chosen.
      const french = page.waitForResponse((r) => /\/hls\/a_fr[^/]*\//.test(r.url()) && r.status() === 200);
      await audio.selectOption({ label: 'French' });
      await french;
    } else {
      // Safari's own player: its audio track list says which is on.
      await audio.selectOption({ label: 'French' });
      await expect
        .poll(() => page.locator('video').evaluate((v) => Array.from(v.audioTracks ?? []).find((t) => t.enabled)?.language ?? null))
        .toBe('fr');
    }
    await expect(audio.locator('option:checked')).toHaveText('French');
  });

  await test.step('French subtitles from the bar', async () => {
    await page.getByLabel('Subtitles').selectOption({ label: 'French' });
    const tracks = () =>
      // The film's own subtitle files (Safari can add tracks of its own from the stream).
      page.locator('video track').evaluateAll((els) => els.map(({ track: t }) => ({ language: t.language, mode: t.mode, cue: t.cues?.[0]?.text ?? null })));
    await expect.poll(async () => (await tracks()).map((t) => `${t.language} ${t.mode}`)).toEqual(['en disabled', 'fr showing']);
    await expect.poll(async () => (await tracks())[1].cue).toBe('Le poisson-lanterne nage la nuit.');
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
    expect(summary).toContain('Audio: French');
    expect(summary).toContain('Subtitles: French');
    for (const text of [await panel.innerText(), summary]) {
      expect(text).not.toMatch(/https?:|blob:|data:|localhost|\/media\/|\/t\//i);
      for (const secret of [ticket.code, film.title, film.slug, cinemaName(), label]) expect(text).not.toContain(secret);
    }
  });
});
