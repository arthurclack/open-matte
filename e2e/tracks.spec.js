// Audio and subtitles: the forced French track shows by itself with French audio
// and subtitles Off, and follows the audio; a second film in the same browser
// starts in the languages and subtitle style chosen in the first, and a remembered
// Off beats its default subtitles; a track turned on outside the bar, as the
// browser's own menu does, moves the bar. Only the viewer's choices are kept, and
// only as language codes. On a phone the bar is rows, with Aa beside Subtitles, or
// at the left when no menu comes before it. Every browser; skips where the browser
// can't decode H.264 and AAC, since the audio tracks are only known once the film
// loads.
import { admin, audioHeard, expect, film, media, playButton, playbackSupport, secondFilm, test, unique } from './fixtures.js';

// Opens a fresh ticket's link and presses Play, or skips where the film can't play.
async function startFilm(page, testInfo, forFilm = film) {
  const ticket = await admin.issueTicket({ label: unique('Tracks', testInfo), for: forFilm });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: forFilm.title })).toBeVisible();
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);
  await playButton(page).click();
  await expect(page.locator('video')).toBeVisible();
}

const bar = (page) => ({
  audio: page.getByLabel('Audio'),
  subtitles: page.getByLabel('Subtitles'),
  chosen: (select) => select.locator('option:checked'),
});

test('the forced French track shows by itself with French audio and subtitles Off, and follows the audio', async ({ page }, testInfo) => {
  const heard = audioHeard(page);
  await startFilm(page, testInfo);
  const { audio, subtitles, chosen } = bar(page);
  await expect(chosen(audio)).toHaveText('English · Stereo');

  await test.step('English audio, subtitles Off: nothing shows', async () => {
    await expect(chosen(subtitles)).toHaveText('Off');
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) disabled']);
  });

  await test.step('French audio: the forced track shows, and Off says so', async () => {
    const since = heard.mark();
    await audio.selectOption({ label: 'French · Stereo' });
    await heard.is({ language: 'fr', rendition: 'a_fr_1', since });
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) showing']);
    await expect.poll(() => media.shownCue(page)).toBe(film.cues[2]);
    // Never in the menu itself.
    await expect(subtitles.locator('option')).toHaveText(['Off · signs and foreign dialogue shown', 'English', 'French']);
    await expect(chosen(subtitles)).toHaveText('Off · signs and foreign dialogue shown');
  });

  await test.step('Playback help names it by its language', async () => {
    await page.getByRole('button', { name: 'Playback help' }).click();
    const panel = page.getByRole('region', { name: 'Playback help' });
    await expect(panel.locator('dt:text-is("Subtitles") + dd')).toHaveText('Off (French forced subtitles showing)');
    await panel.press('Escape');
    await expect(panel).toBeHidden();
  });

  await test.step('English audio again: it goes, and the menu reads Off', async () => {
    await audio.selectOption({ label: 'English · Stereo' });
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) disabled']);
    await expect(chosen(subtitles)).toHaveText('Off');
  });

  await test.step('French again: it returns', async () => {
    await audio.selectOption({ label: 'French · Stereo' });
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) showing']);
  });

  // The forced track was the player's doing, not a choice.
  expect(await media.remembered(page)).toEqual({ audioLanguage: 'fr' });
});

test('a second film starts in the languages and subtitle style chosen in the first, and a remembered Off beats its default', async ({ page }, testInfo) => {
  const heard = audioHeard(page);
  const { audio, subtitles, chosen } = bar(page);
  const picture = page.locator('video').locator('xpath=..');

  await test.step('the first film: French audio, French subtitles, large on a box', async () => {
    await startFilm(page, testInfo);
    await audio.selectOption({ label: 'French · Stereo' });
    await heard.is({ language: 'fr', rendition: 'a_fr_1' });
    await subtitles.selectOption({ label: 'French' });
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French showing', 'French (forced) disabled']);

    const aa = page.getByRole('button', { name: 'Aa subtitle style' });
    await aa.click();
    const panel = page.getByRole('group', { name: 'Subtitle style' });
    await panel.getByRole('radio', { name: 'Large' }).check();
    await panel.getByRole('radio', { name: 'Box' }).check();
    await expect(picture).toHaveClass(/(^| )cues-large( |$)/);
    await expect(picture).toHaveClass(/(^| )cues-box( |$)/);
    // Escape closes the panel and hands focus back to Aa.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(aa).toBeFocused();

    // Language codes and the two style settings: no title, no address.
    expect(await media.remembered(page)).toEqual({ audioLanguage: 'fr', subtitles: 'fr', subtitleSize: 'large', subtitleBackground: 'box' });
  });

  await test.step('the second film starts in Canadian French, with its French subtitles, untouched', async () => {
    const since = heard.mark();
    await startFilm(page, testInfo, secondFilm);
    await heard.is({ language: 'fr-CA', rendition: 'a_fr-CA_1', since });
    await expect(chosen(audio)).toHaveText('French (Canada) · Stereo');
    await expect(chosen(subtitles)).toHaveText('French (Canada)');
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French (Canada) showing']);
    await expect.poll(() => media.shownCue(page)).toBe(secondFilm.cues[1]);
    await expect(picture).toHaveClass(/(^| )cues-large( |$)/);
    await expect(picture).toHaveClass(/(^| )cues-box( |$)/);
    // What the player picked by itself (fr-CA) isn't saved over the choice (fr).
    expect(await media.remembered(page)).toEqual({ audioLanguage: 'fr', subtitles: 'fr', subtitleSize: 'large', subtitleBackground: 'box' });
  });

  await test.step('back in the first film, subtitles Off', async () => {
    await page.goto(`/${film.slug}`);
    await playButton(page).click();
    await expect(chosen(subtitles)).toHaveText('French');
    await subtitles.selectOption('-1');
    // French audio is still on, so its forced track takes over.
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) showing']);
    expect((await media.remembered(page)).subtitles).toBe('off');
  });

  await test.step('the second film starts with none, though English is its default', async () => {
    const since = heard.mark();
    await page.goto(`/${secondFilm.slug}`);
    await playButton(page).click();
    await heard.is({ language: 'fr-CA', rendition: 'a_fr-CA_1', since });
    await expect(chosen(subtitles)).toHaveText('Off');
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French (Canada) disabled']);
  });
});

test('a subtitle track turned on outside the bar, as the browser’s own menu does, moves the bar; the forced one counts as Off', async ({ page }, testInfo) => {
  await startFilm(page, testInfo);
  const { subtitles, chosen } = bar(page);
  await media.playedPast(page, 0.2);
  // Until the film has played a moment, a track the browser shows is its own pick as
  // the film loads. A viewer reaching for its menu has touched the video's controls.
  await page.locator('video').dispatchEvent('pointerdown');

  // What a browser's menu does: the picked track shows, and the others go.
  const pick = (label) =>
    page.locator('video track').evaluateAll((els, wanted) => {
      for (const el of els) if (el.label === wanted) el.track.mode = 'showing';
      for (const el of els) if (el.label !== wanted) el.track.mode = 'disabled';
    }, label);

  await test.step('French, picked there, shows in the bar and is remembered', async () => {
    await pick('French');
    await expect(chosen(subtitles)).toHaveText('French');
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French showing', 'French (forced) disabled']);
    expect(await media.remembered(page)).toEqual({ subtitles: 'fr' });
  });

  await test.step('the forced track, picked there, leaves the bar at Off', async () => {
    await pick('French (forced)');
    await expect(chosen(subtitles)).toHaveText('Off');
    // With English audio the forced French track has no reason to show.
    await expect.poll(() => media.subtitleModes(page)).toEqual(['English disabled', 'French disabled', 'French (forced) disabled']);
    expect(await media.remembered(page)).toEqual({ subtitles: 'off' });
  });
});

test('on a phone the bar is rows: the menus start at one place, and Aa sits beside Subtitles, or at the left with no menu before it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { audio, subtitles } = bar(page);
  const aa = page.getByRole('button', { name: 'Aa subtitle style' });
  const help = page.getByRole('button', { name: 'Playback help' });

  await test.step('two audio tracks and subtitles: Aa on the Subtitles row, after its menu', async () => {
    await startFilm(page, testInfo);
    await expect(audio).toBeVisible();
    const [heard, shown, style] = await Promise.all([audio, subtitles, aa].map((l) => l.boundingBox()));
    expect(Math.abs(heard.x - shown.x), 'both menus start at the same place').toBeLessThan(1);
    expect(style.x).toBeGreaterThanOrEqual(shown.x + shown.width);
    const middle = style.y + style.height / 2;
    expect(middle > shown.y && middle < shown.y + shown.height, 'Aa is on the Subtitles row').toBe(true);
  });

  await test.step('one audio track and only forced subtitles: Aa starts its own row, at the left', async () => {
    // The same film, as if it had nothing but the French sign to show and only
    // English to hear: no Audio menu and no Subtitles menu, so Aa comes first.
    await page.route(
      (url) => url.pathname === `/api/films/${film.slug}`,
      async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.film.media.subtitles = json.film.media.subtitles.filter((s) => s.forced);
        await route.fulfill({ response, json });
      },
    );
    await page.route(
      (url) => url.pathname === `/media/${film.slug}/hls/master.m3u8`,
      async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace(/^#EXT-X-MEDIA:TYPE=AUDIO,.*LANGUAGE="fr".*\n/m, '');
        await route.fulfill({ response, body });
      },
    );
    await startFilm(page, testInfo);
    // Playing means the audio tracks are known, so no Audio menu is still to come.
    await media.playedPast(page, 0.5);
    await expect(audio).toHaveCount(0);
    await expect(subtitles).toHaveCount(0);
    const [style, link] = await Promise.all([aa, help].map((l) => l.boundingBox()));
    expect(Math.abs(style.x - link.x), 'Aa lines up with Playback help, at the left').toBeLessThan(1);
    expect(style.y + style.height).toBeLessThanOrEqual(link.y);
  });
});
