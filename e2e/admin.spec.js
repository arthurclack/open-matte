// Admin smoke: signing in through the form with the run's password, Films, the
// film, sending a link from its page and finding it under Tapes, Status (with a
// media request it saw refused), and the Ledger filtered by the film and to
// viewing. Nothing may throw, and nothing may log an error in
// the console. Every browser.
import { CSP_MESSAGE, NO_SNAPSHOTS, admin, expect, film, filmFolders, secondFilm, signInAsAdmin, test, unique } from './fixtures.js';

test.use(NO_SNAPSHOTS);

test('the admin signs in, sends a link from the film page, and reads Tapes, Status and the Ledger', async ({ page, newContext }, testInfo) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Before signing in, the admin asks whether it's signed in and is told no:
    // browsers log that refusal themselves.
    const refusedSessionCheck = /Failed to load resource/.test(msg.text()) && msg.location().url.endsWith('/api/admin/session');
    // What the Content-Security-Policy blocked is the guard's to judge (fixtures.js).
    if (!refusedSessionCheck && !CSP_MESSAGE.test(msg.text())) consoleErrors.push(`${msg.text()} (${msg.location().url})`);
  });

  await test.step('sign in through the form', async () => {
    await page.goto('/admin');
    await signInAsAdmin(page, () => page.getByRole('button', { name: 'Sign in' }).click());
    await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();
  });

  const label = unique('Smoke', testInfo);
  let link;
  await test.step('Films, the film, and a link sent from its page', async () => {
    await page.getByRole('link', { name: new RegExp(film.title) }).click();
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === `/admin/films/${film.id}`);
    await page.getByRole('textbox', { name: 'Who is it for?' }).fill(label);
    await page.getByRole('button', { name: 'Send a link for anyone with the link' }).click();
    const issued = page.locator('.ui-line--done').filter({ hasText: '1 link ready.' });
    await expect(issued).toBeVisible();
    await expect(issued).toContainText(`For ${label}`);
    await expect(issued.locator('code')).toHaveText(/^http:\/\/localhost:\d+\/t\/[a-z0-9]{13}$/);
    link = await issued.locator('code').textContent();
  });

  await test.step('the link opens the film in another browser', async () => {
    const guest = await (await newContext()).newPage();
    await guest.goto(link);
    await expect(guest.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  });

  await test.step('a browser with no ticket is refused the film', async () => {
    const stranger = await (await newContext()).newPage();
    await stranger.goto('/');
    const status = await stranger.evaluate((url) => fetch(url).then((r) => r.status), `/media/${film.slug}/hls/master.m3u8`);
    expect(status).toBe(403);
  });

  await test.step('the link is under Tapes, in Links sent', async () => {
    await page.getByRole('link', { name: 'Tapes', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tapes' })).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: label }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(film.title);
    await expect(row).toContainText('Anyone with the link');
  });

  await test.step('Status', async () => {
    // The tab, not the status line's own "Status" link, which shows whenever the
    // server has something to look at (a nearly full disk on the computer running this).
    await page.getByRole('navigation', { name: 'Back office' }).getByRole('link', { name: 'Status', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Needs attention' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The server' })).toBeVisible();
    // The stranger's refusal, among any the other journeys caused: no address, just the film.
    await expect(page.getByText(/^\d+ media requests? refused since the server started/)).toBeVisible();
    const refused = page.getByRole('row').filter({ has: page.getByRole('cell', { name: `/${film.slug}`, exact: true }) });
    await expect(refused.first()).toContainText('403');
    // The media folder holds the journeys' two films, once for each browser project.
    await expect(page.locator('dt:text-is("Media folder") + dd')).toContainText(`Readable. ${filmFolders()} folders in it now.`);
  });

  await test.step('the Ledger, filtered by the film and to viewing', async () => {
    // What the filters have to leave out, beside the guest's opening of this film:
    // the other film's ticket opened in a third browser, and a ticket for this film
    // given to someone (an accounts-and-links event, not a viewing one).
    const otherLabel = unique('Other film', testInfo);
    const other = await admin.issueTicket({ label: otherLabel, for: secondFilm });
    const otherGuest = await (await newContext()).newPage();
    await otherGuest.goto(`/t/${other.code}`);
    await expect(otherGuest.getByRole('heading', { level: 1, name: secondFilm.title })).toBeVisible();
    const givenLabel = unique('Given', testInfo);
    const given = await admin.issueTicket({ label: givenLabel });
    const person = await admin.newPerson(unique('Ada', testInfo));
    await admin.post(`/api/admin/tickets/${given.id}/holder`, { personId: person.id });

    // Activity asks for the events again with each change of filter, from a list drawn
    // afresh: once that answer is in, the rows are the filtered ones, and a row that
    // isn't there is one the filter left out (not one still loading).
    const loaded = (filters) =>
      page.waitForResponse((r) => {
        const url = new URL(r.url());
        if (url.pathname !== '/api/admin/activity' || url.searchParams.has('before')) return false;
        return ['film', 'kind'].every((key) => (url.searchParams.get(key) ?? '') === (filters[key] ?? ''));
      });
    const rows = (text) => page.getByRole('row').filter({ hasText: text });
    const onlyThisFilm = { film: String(film.id) };
    const onlyViewing = { ...onlyThisFilm, kind: 'viewing' };

    let answer = loaded({});
    await page.getByRole('link', { name: 'Ledger', exact: true }).click();
    await answer;
    await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
    // Only the two links just sent: the unfiltered Ledger shows the newest 200 events
    // of the whole shop, and with four browsers' journeys writing to it this journey's
    // first link can already be further down. It is looked for under the film's filter.
    for (const text of [otherLabel, givenLabel]) await expect(rows(text).first()).toBeVisible();

    answer = loaded(onlyThisFilm);
    await page.getByRole('combobox', { name: 'Film' }).selectOption({ label: film.title });
    await answer;
    await expect(page).toHaveURL((url) => url.searchParams.get('film') === onlyThisFilm.film);
    await expect(rows(label).first()).toBeVisible();
    await expect(rows(givenLabel).first()).toBeVisible();
    await expect(rows(otherLabel)).toHaveCount(0);

    answer = loaded(onlyViewing);
    await page.getByRole('button', { name: 'Viewing' }).click();
    await answer;
    await expect(page).toHaveURL((url) => url.searchParams.get('kind') === 'viewing' && url.searchParams.get('film') === onlyViewing.film);
    await expect(page.getByRole('button', { name: 'Viewing' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(label).first()).toBeVisible();
    await expect(rows(otherLabel)).toHaveCount(0);
    await expect(rows(givenLabel)).toHaveCount(0);

    // The filters survive a reload.
    answer = loaded(onlyViewing);
    await page.reload();
    await answer;
    await expect(page.getByRole('combobox', { name: 'Film' })).toHaveValue(onlyViewing.film);
    await expect(page.getByRole('button', { name: 'Viewing' })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(label).first()).toBeVisible();
    await expect(rows(otherLabel)).toHaveCount(0);
  });

  expect(consoleErrors, 'errors in the console').toEqual([]);
});
