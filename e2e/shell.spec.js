// Around the pages: what the viewer site and the admin say when something goes wrong
// or someone leaves. The name menu works over the player; a film page says when the
// screening it just started is open, when Play failed, and when the browser was
// signed out under it; a start-by deadline shows with its time, in the friend's own
// time zone, and its year once it has passed; a part of the app that's gone since a
// deploy, or a mangled link, shows a page rather than a blank one; the tab's title
// follows the page. In the admin, a setup link that opens a film is worded as one, a
// tape that is out can be come back to until it's due (as the film page said before
// Play), and Sign out only looks done once the server has done it. Signing out just
// after Play names the tape that goes back, and a tape handed back is gone from the
// front page reached without a reload. Back after signing out is in back.spec.js. Every browser.
import { NO_SNAPSHOTS, admin, cinemaName, expect, film, heartbeats, playButton, signInAsAdmin, signedInPerson, test, unique } from './fixtures.js';

// The admin's sign-in puts the run's password in a form field, and trace snapshots
// would keep it: none in this file.
test.use(NO_SNAPSHOTS);

// A new person, signed in in this browser, with a ticket of their own for the film:
// so signing out has no link tickets to warn about.
async function signedInWithTicket(context, testInfo, fields = {}) {
  const name = unique('Sam', testInfo);
  const { person, cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  await admin.issueTicket({ personId: person.id, ...fields });
  return { person, menu: (page) => page.getByRole('button', { name, exact: true }) };
}

// Presses Play and waits until the server has started the screening.
async function pressPlay(page) {
  const started = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/films/${film.slug}/screenings` && r.request().method() === 'POST');
  await playButton(page).click();
  return started;
}

test('the name menu opens over the player, and Sign out there works', async ({ page, context }, testInfo) => {
  const { menu } = await signedInWithTicket(context, testInfo);
  await page.goto(`/${film.slug}`);
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(page.locator('.theatre video')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  await menu(page).click();
  // The menu opens downwards, over the video: each item has to be the thing a click lands on.
  for (const name of ['Your tapes', 'Your membership card', 'Sign out']) {
    const item = page.getByRole('menuitem', { name });
    const onTop = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(onTop, `${name} is above the video`).toBe(true);
  }
  await page.getByRole('menuitem', { name: 'Sign out' }).click({ timeout: 5000 });
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(menu(page)).toBeHidden();
});

// (1.x: "3 plays left" before Play. Play limits are gone: a link lends its tape once,
// for its days, and the counter says how long before Play is pressed. Slice 7: one
// clock, so the counter says Play takes the tape out, for the link's days, until a
// date; and once Play has, that it has.)
test('after Play, the counter tells of the tape just taken', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Panel', testInfo), loanDays: 2 });
  await page.goto(`/t/${ticket.code}`);
  const panel = page.locator('.fl-counter');
  await expect(panel).toContainText("Pressing Play takes the tape out. It's yours for 2 days, until");
  await expect(panel.locator('.ob--sticker')).toContainText('Play takes it out.');
  await expect(panel).not.toContainText('plays left');
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(panel).toContainText("Taken out. It's yours until it's due back");
  await expect(panel.getByRole('button', { name: 'Return it now' })).toBeVisible();
  await expect(panel).not.toContainText('Pressing Play');
});

test('Play that fails for no reason the page knows says so', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Play fails', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(playButton(page)).toBeVisible();
  // A proxy's answer while the app restarts during a deploy.
  await page.route(`**/api/films/${film.slug}/screenings`, (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }));
  await playButton(page).click();
  await expect(page.locator('.fl-message')).toHaveText("Couldn't start playback. Try again in a moment.");
  await expect(playButton(page)).toBeEnabled();
});

test('a browser signed out while it plays is told so, and offered Sign in', async ({ page, context }, testInfo) => {
  const { person } = await signedInWithTicket(context, testInfo);
  const reports = heartbeats(page);
  await page.goto(`/${film.slug}`);
  expect((await pressPlay(page)).status()).toBe(200);
  const video = page.locator('.theatre video');
  await expect(video).toBeVisible();
  // Paused, where the browser can play it, so that the next thing the player sends is
  // the progress report below rather than a request for more of the film.
  if (await video.evaluate((v) => (v.paused ? false : (v.pause(), true)))) {
    await expect.poll(() => reports.some((r) => r.status === 200 && r.playing === false), { message: 'the pause is reported' }).toBe(true);
  }

  await admin.post(`/api/admin/people/${person.id}/disable`);
  // The next progress report would come within 30 seconds of playing; a pause sends one at once.
  const told = page.waitForResponse(
    async (r) => /\/api\/screenings\/\d+\/heartbeat$/.test(new URL(r.url()).pathname) && (await r.json().catch(() => null))?.error === 'signed-out',
    { timeout: 10_000 },
  );
  await video.evaluate((v) => v.dispatchEvent(new Event('pause')));
  expect((await told).status()).toBe(404);

  await expect.poll(() => page.evaluate(() => window.__playerMessages)).toContain('This browser has been signed out, so the film has stopped.');
  await expect(page.getByRole('heading', { level: 1, name: 'This browser has been signed out' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/signin?next=${encodeURIComponent(`/${film.slug}`)}`);
  // With the player gone, the header offers Sign in again too.
  await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test("a ticket's start-by deadline shows with its time, in the friend's time zone", async ({ newContext }, testInfo) => {
  // The end of a day in UTC, ten days on: 08:59 the next morning in Tokyo, which has
  // no summer time.
  const day = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const startBy = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999);
  const ticket = await admin.issueTicket({ label: unique('Abroad', testInfo), startBy });
  const page = await (await newContext({ timezoneId: 'Asia/Tokyo', locale: 'en-GB' })).newPage();
  await page.goto(`/t/${ticket.code}`);
  // Safari writes "Sun 15 Nov at 08:59" where the others write "Sun 15 Nov, 08:59".
  await expect(page.locator('.fl-counter')).toContainText(/Start watching by \S+ \d{1,2} \S+(,| at) 08:59\./);
});

test('a start-by deadline that has passed shows its year', async ({ newContext }, testInfo) => {
  // The end of a day in UTC, over a year ago.
  const day = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const startBy = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999);
  const ticket = await admin.issueTicket({ label: unique('Last year', testInfo), startBy });
  const page = await (await newContext({ timezoneId: 'UTC', locale: 'en-GB' })).newPage();
  await page.goto(`/t/${ticket.code}`);
  await expect(page.locator('.fl-counter')).toContainText(
    new RegExp(`This tape needed to be started by ${day.getUTCDate()} \\S+ ${day.getUTCFullYear()}(,| at) 23:59\\.`),
  );
});

test('the tab is named after the film on its page, and after the cinema again once you leave', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Title', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page).toHaveTitle(`${film.title} · ${cinemaName()}`);
  await page.locator('header').getByRole('link', { name: cinemaName() }).click();
  await expect(page.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
  await expect(page).toHaveTitle(cinemaName());
});

test('a part of the app gone since a deploy: Play says to reload, and reloading resumes', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Deploy', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(playButton(page)).toHaveAccessibleName('Play');
  // The player's file from the build this page came with, removed by a newer one.
  await page.route('**/assets/Player-*.js', (route) => route.fulfill({ status: 404, body: '' }));
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'This page needs reloading' })).toBeVisible();
  // The header stays, with the cinema's name.
  await expect(page.locator('header').getByRole('link', { name: cinemaName() })).toBeVisible();

  await page.unroute('**/assets/Player-*.js');
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(playButton(page)).toHaveAccessibleName(/^Resume/);
});

// Version 2: a link lends once. The tape goes back with Return it now, asked on the
// page (slice 7). (docs/version-2.md, "Browser journeys", 6.)
test('a spent link in a fresh browser shows the notice, and nothing of the film', async ({ page, newContext }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Spent', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  expect((await pressPlay(page)).status()).toBe(200);
  const panel = page.locator('.fl-counter');
  await panel.getByRole('button', { name: 'Return it now' }).click();
  await expect(panel.getByRole('group', { name: /^Return .+ now\?/ })).toBeVisible();
  const returned = page.waitForResponse((r) => r.url().endsWith(`/api/films/${film.slug}/return`));
  await panel.getByRole('button', { name: 'Return it', exact: true }).click();
  expect((await returned).status()).toBe(200);
  await expect(panel).toContainText('Returned on');
  await expect(panel).toContainText("This link has done its job: it won't take the tape out again.");

  const fresh = await (await newContext()).newPage();
  await fresh.goto(`/t/${ticket.code}`);
  await expect(fresh).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('notice') === 'ticket-spent');
  await expect(fresh.locator('.fl-notice')).toContainText('That link has been used.');
  await expect(fresh.locator('.fl-notice')).toContainText('The tape it lent is back in the shop.');
  await expect(fresh.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
  await expect(fresh.getByText(film.title)).toHaveCount(0);
  // The browser that borrowed it still has the film's page, and no Play.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  await expect(playButton(page)).toHaveCount(0);
});

// Question 5, and the review of slices 7 to 9: signing out just after Play, with no
// reload, names the tape that goes back (the question is asked from /api/me read
// again), and the front page reached without a reload shows it out to this browser.
test('signing out just after Play names the tape that goes back, with no reload', async ({ page, context }, testInfo) => {
  const name = unique('Joanna', testInfo);
  const { cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  // A link anyone can use: pressed by a signed-in member, the tape is this browser's.
  const ticket = await admin.issueTicket({ label: unique('Anyone', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(page.locator('.theatre video')).toBeVisible();

  // The shop's name in the header goes to the front page without a reload.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('header .site-home').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Out to this browser' })).toBeVisible();

  const asked = new Promise((resolve) =>
    page.once('dialog', async (dialog) => {
      resolve(dialog.message());
      await dialog.dismiss();
    }),
  );
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  expect(await asked).toBe(`Sign out of this browser? ${film.title} is out to this browser, so it goes back to the shop, and the link that took it out won't take it out again.`);
  // Not signed out: the question was dismissed.
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

// The review of slices 7 to 9: a tape handed back with a response is gone from the
// front page reached from "Handed back" (a link, not a reload).
test('a tape handed back with a response is no longer on your card on the front page', async ({ page, context }, testInfo) => {
  await signedInWithTicket(context, testInfo);
  await page.goto(`/${film.slug}`);
  expect((await pressPlay(page)).status()).toBe(200);
  await page.locator('.fl-counter').getByRole('button', { name: 'Hand it back' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hand it back' })).toBeFocused();
  await page.getByRole('radio', { name: 'Not for me' }).check();
  const returned = page.waitForResponse((r) => r.url().endsWith(`/api/films/${film.slug}/return`));
  await page.getByRole('button', { name: 'Hand it back', exact: true }).click();
  expect((await returned).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Handed back' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to your tapes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your tapes' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: film.title })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'On your card' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Return it now: ${film.title}` })).toHaveCount(0);
});

test('mangled links show the front page, or nothing showing, never a blank page', async ({ page }) => {
  await page.goto('/?notice=__proto__');
  await expect(page.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
  await expect(page.locator('.fl-notice')).toHaveCount(0);

  // '../me' once decoded: it must be asked for as a film, not as /api/me.
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith('/api/films/'), { timeout: 10_000 });
  await page.goto('/..%2Fme');
  expect(new URL((await asked).url()).pathname).toBe('/api/films/..%2Fme');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing on the shelf here' })).toBeVisible();
});

test("the admin: a setup link's message, a loan's due-back date on its link's page, and Sign out when the server never heard", async ({ page, newContext }, testInfo) => {
  const name = unique('Noor', testInfo);
  await admin.newPerson(name);
  await page.goto('/admin');
  await signInAsAdmin(page, () => page.getByRole('button', { name: 'Sign in' }).click());
  await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();

  await test.step("a ticket for someone with no passkey yet, and the setup link that opens it", async () => {
    await page.goto(`/admin/films/${film.id}`);
    await page.getByRole('radio', { name: /Only one member, signed in/ }).check();
    await page.getByRole('combobox', { name: 'Which member' }).selectOption({ label: name });
    await page.getByRole('button', { name: `Send a link to ${name} only` }).click();
    await page.getByRole('button', { name: `Create a setup link that opens ${film.title}` }).click();
    // Inside the ticket's own notice, which has a Copy message of its own.
    const created = page.locator('.ui-line--done').filter({ hasText: `Setup link for ${name}:` }).last();
    await expect(created).toBeVisible();
    await created.getByRole('button', { name: 'Copy message' }).click();
    const message = await page.evaluate(() => window.__copied);
    expect(message).toContain(`You should watch ${film.title}.`);
    expect(message).toContain('to create a passkey');
    expect(message).toMatch(/It works once, until .+\. http:\/\/localhost:\d+\/enroll#/);
    expect(message).not.toContain("you'll sign in with your passkey");
  });

  // (1.x: a ticket valid one day after its first play, against a 48-hour resume
  // window. Version 2 has one clock: the link lends for its own days, here one.)
  await test.step('a link that lends for a day: the tape can be come back to until it is due', async () => {
    const ticket = await admin.issueTicket({ label: unique('Short', testInfo), loanDays: 1 });
    const guest = await (await newContext()).newPage();
    await guest.goto(`/t/${ticket.code}`);
    // Before Play, the friend is promised the link's own day, not the shop's three.
    await expect(guest.locator('.fl-counter')).toContainText("It's yours for 1 day, until");
    expect((await pressPlay(guest)).status()).toBe(200);
    await page.goto(`/admin/tickets/${ticket.id}`);
    // (1.x's link page had "Expires" and "Can come back until". Version 2's, slice 9,
    // has the loan: when Play took the tape, and when it's due back, a day later.)
    const due = page.locator('dt:text-is("Due back") + dd');
    // A date and time, on a 24-hour clock or a 12-hour one, as the browser's language has it.
    await expect(due).toHaveText(/\d:\d\d(\s*[AP]M)? \(in 2[34] hours\)$/);
    await expect(page.locator('dt:text-is("Took the tape") + dd')).toHaveText(/\d:\d\d(\s*[AP]M)?$/);
    await expect(page.locator('dt:text-is("Now") + dd')).toContainText("can carry on until it's due back");
    await expect(page.locator('.of-head .of-marks').first()).toContainText('Has the tape');
  });

  await test.step('Sign out with the connection gone: still signed in, and told so', async () => {
    await page.route('**/api/admin/logout', (route) => route.abort('internetdisconnected'));
    await page.getByRole('navigation', { name: 'Back office' }).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.admin-main [role="alert"]')).toHaveText("Couldn't sign out. Check your connection and try again.");
    await expect(page.getByLabel('Back office password')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tapes', exact: true })).toBeVisible();
  });

  await test.step('and once it can be reached, Sign out signs out', async () => {
    await page.unroute('**/api/admin/logout');
    await page.getByRole('navigation', { name: 'Back office' }).getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to the back office' })).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Sign in to the back office' })).toBeVisible();
  });
});
