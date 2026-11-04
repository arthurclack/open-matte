// Around the pages: what the viewer site and the admin say when something goes wrong
// or someone leaves. The name menu works over the player; a film page says when the
// screening it just started is open, when Play failed, and when the browser was
// signed out under it; a start-by deadline shows with its time, in the friend's own
// time zone, and its year once it has passed; a part of the app that's gone since a
// deploy, or a mangled link, shows a page rather than a blank one; the tab's title
// follows the page. In the admin, a setup link that opens a film is worded as one, an
// open screening is resumable until the ticket expires if that comes first (as the
// film page said before Play), and Sign out only looks done once the server has done
// it. Back after signing out is in back.spec.js. Every browser.
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
  return { person, menu: (page) => page.getByRole('button', { name: `${name} ▾` }) };
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
  for (const name of ['Your tickets', 'Your account', 'Sign out']) {
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

test('after Play, the ticket panel tells of the open screening', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Panel', testInfo), screeningLimit: 3 });
  await page.goto(`/t/${ticket.code}`);
  const panel = page.locator('.ticket-panel');
  await expect(panel).toContainText('3 screenings left on this ticket.');
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(panel).toContainText('Your screening is open until');
  await expect(panel).not.toContainText('Pressing Play starts a screening');
});

test('Play that fails for no reason the page knows says so', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Play fails', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(playButton(page)).toBeVisible();
  // A proxy's answer while the app restarts during a deploy.
  await page.route(`**/api/films/${film.slug}/screenings`, (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' }));
  await playButton(page).click();
  await expect(page.locator('.notice')).toHaveText("Couldn't start playback. Try again in a moment.");
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
  // Safari writes "15 Nov at 08:59" where the others write "15 Nov, 08:59".
  await expect(page.locator('.ticket-panel')).toContainText(/Start watching by \d{1,2} \S+(,| at) 08:59\./);
});

test('a start-by deadline that has passed shows its year', async ({ newContext }, testInfo) => {
  // The end of a day in UTC, over a year ago.
  const day = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const startBy = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999);
  const ticket = await admin.issueTicket({ label: unique('Last year', testInfo), startBy });
  const page = await (await newContext({ timezoneId: 'UTC', locale: 'en-GB' })).newPage();
  await page.goto(`/t/${ticket.code}`);
  await expect(page.locator('.ticket-panel')).toContainText(
    new RegExp(`This ticket needed to be used by ${day.getUTCDate()} \\S+ ${day.getUTCFullYear()}(,| at) 23:59\\.`),
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
  await expect(playButton(page)).toHaveText('▶ Play');
  // The player's file from the build this page came with, removed by a newer one.
  await page.route('**/assets/Player-*.js', (route) => route.fulfill({ status: 404, body: '' }));
  expect((await pressPlay(page)).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'This page needs reloading' })).toBeVisible();
  // The header stays, with the cinema's name.
  await expect(page.locator('header').getByRole('link', { name: cinemaName() })).toBeVisible();

  await page.unroute('**/assets/Player-*.js');
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(playButton(page)).toHaveText(/^▶ Resume/);
});

test('mangled links show the front page, or nothing showing, never a blank page', async ({ page }) => {
  await page.goto('/?notice=__proto__');
  await expect(page.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
  await expect(page.locator('.notice')).toHaveCount(0);

  // '../me' once decoded: it must be asked for as a film, not as /api/me.
  const asked = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith('/api/films/'), { timeout: 10_000 });
  await page.goto('/..%2Fme');
  expect(new URL((await asked).url()).pathname).toBe('/api/films/..%2Fme');
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing showing here' })).toBeVisible();
});

test("the admin: a setup link's message, an open screening's last chance to resume, and Sign out when the server never heard", async ({ page, newContext }, testInfo) => {
  const name = unique('Noor', testInfo);
  await admin.newPerson(name);
  await page.goto('/admin');
  await signInAsAdmin(page, () => page.getByRole('button', { name: 'Sign in' }).click());
  await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();

  await test.step("a ticket for someone with no passkey yet, and the setup link that opens it", async () => {
    await page.goto(`/admin/films/${film.id}`);
    await page.getByRole('radio', { name: /Only a person, signed in/ }).check();
    await page.getByRole('combobox', { name: 'Which person' }).selectOption({ label: name });
    await page.getByRole('button', { name: `Issue ticket for ${name} only` }).click();
    await page.getByRole('button', { name: `Create a setup link that opens ${film.title}` }).click();
    // Inside the ticket's own notice, which has a Copy message of its own.
    const created = page.locator('.notice.good').filter({ hasText: `Setup link for ${name}:` }).last();
    await expect(created).toBeVisible();
    await created.getByRole('button', { name: 'Copy message' }).click();
    const message = await page.evaluate(() => window.__copied);
    expect(message).toContain(`You should watch ${film.title}.`);
    expect(message).toContain('to create a passkey');
    expect(message).toMatch(/It works once, until .+\. http:\/\/localhost:\d+\/enroll#/);
    expect(message).not.toContain("you'll sign in with your passkey");
  });

  await test.step('a ticket that expires before its resume window ends: resumable until it expires', async () => {
    // A day from first play, and the resume window's default is 48 hours.
    const ticket = await admin.issueTicket({ label: unique('Short', testInfo), daysAfterFirstPlay: 1 });
    const guest = await (await newContext()).newPage();
    await guest.goto(`/t/${ticket.code}`);
    // Before Play, the friend isn't promised the 48 hours either.
    await expect(guest.locator('.ticket-panel')).toContainText('You can pause and come back to it until the ticket expires.');
    expect((await pressPlay(guest)).status()).toBe(200);
    await page.goto(`/admin/tickets/${ticket.id}`);
    const expires = page.locator('dt:text-is("Expires") + dd');
    // A date and time, now that it has been played.
    await expect(expires).toHaveText(/\d:\d\d/);
    const until = await expires.textContent();
    await expect(page.locator('dt:text-is("Open screening") + dd')).toContainText(`resumable until ${until}`);
    await expect(page.locator('td[data-label="Resumable until"]')).toHaveText(until);
  });

  await test.step('Sign out with the connection gone: still signed in, and told so', async () => {
    await page.route('**/api/admin/logout', (route) => route.abort('internetdisconnected'));
    await page.locator('.admin-nav').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.admin-main > .notice.bad')).toHaveText("Couldn't sign out. Check your connection and try again.");
    await expect(page.getByLabel('Admin password')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tickets', exact: true })).toBeVisible();
  });

  await test.step('and once it can be reached, Sign out signs out', async () => {
    await page.unroute('**/api/admin/logout');
    await page.locator('.admin-nav').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Open Matte admin' })).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Open Matte admin' })).toBeVisible();
  });
});
