// Busy buttons (docs/version-2.md, question 20, answer b): while a button's request is
// under way it keeps the focus, is aria-disabled and drawn as disabled, a second press
// sends nothing, and the page's status region says it is busy. Once the request has
// failed, the focus is still on the button, which works again. In the back office
// (Status's Refresh, Sign out, and the film's Show to members, a checkbox saved as it is
// ticked), on a friend's film page (Play, and Return it) and in the name menu (Sign
// out), with each request held until the test lets it go, then answered with an error,
// so nothing held ever reaches the server. Every browser. The parts without a browser
// are test/busy-buttons.test.js.
import { admin, asAdmin, expect, film, playButton, signedInPerson, test, unique } from './fixtures.js';

// Holds every request to `path` (by method) until let go, then answers it with the
// server's own trouble: a 500, which the pages put in their own words. Counts them.
async function holdRequests(page, path, method = 'POST') {
  let letGo;
  const gate = new Promise((resolve) => {
    letGo = resolve;
  });
  const matches = (url) => url.pathname === path;
  const handler = async (route) => {
    if (route.request().method() !== method) return route.fallback();
    held.count++;
    await gate;
    await route.fulfill({ status: 500, json: { error: 'server-error' } });
  };
  // stop: requests go to the server again.
  const held = { count: 0, letGo: () => letGo(), stop: () => page.unroute(matches, handler) };
  await page.route(matches, handler);
  return held;
}

const focused = (locator) => locator.evaluate((el) => el === document.activeElement);

// The press, the second press while busy, the error, and the focus throughout. `press`
// focuses the button and presses Enter, as a keyboard does (WebKit, like Safari,
// doesn't focus a button that is clicked); `busyWords` is what the status region says.
async function holdsTheFocus(page, { button, held, busyWords, failed }) {
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => held.count, { message: 'the press sent its request' }).toBe(1);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).not.toHaveAttribute('disabled');
  await expect(button).toBeDisabled();
  expect(await focused(button), 'the busy button keeps the focus').toBe(true);
  await expect(page.locator('#om-busy[role="status"]')).toHaveText(busyWords);
  // Pressed again while busy, by the keyboard and by a double click: nothing more is sent.
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await button.dblclick({ force: true });
  await page.waitForTimeout(300);
  expect(held.count, 'presses while busy send nothing').toBe(1);
  await button.focus();

  held.letGo();
  // Said as the page says it: an alert in the back office, a status line on the film page.
  await expect(page.locator('[role="alert"], [role="status"]').filter({ hasText: failed }).first()).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await expect(button).toBeEnabled();
  expect(await focused(button), 'after the error, the focus is still on the button').toBe(true);
  await expect(page.locator('#om-busy')).toHaveText('');
}

test('in the back office: Refresh keeps the focus while it checks and after it fails, and a double press checks once', async ({ page, context }) => {
  await asAdmin(context);
  await page.goto('/admin/status');
  await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
  await expect(page.getByText(/^Checked /)).toBeVisible();
  const held = await holdRequests(page, '/api/admin/booth', 'GET');
  await holdsTheFocus(page, {
    button: page.getByRole('button', { name: /^(Refresh|Checking…)$/ }),
    held,
    busyWords: 'Checking…',
    failed: "Couldn't reach the server just now, or it had a problem. Try again in a moment.",
  });
});

test('on a friend’s film page: Play, and then Return it, keep the focus while they wait and after they fail, and a double press sends one request', async ({ page }, testInfo) => {
  const ticket = await admin.issueTicket({ label: unique('Busy', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();

  // Play, refused: the tape never goes out.
  const play = await holdRequests(page, `/api/films/${film.slug}/screenings`);
  await holdsTheFocus(page, { button: playButton(page), held: play, busyWords: 'Just a moment…', failed: "Couldn't start playback. Try again in a moment." });
  await play.stop();

  // Play for real: the tape is out. The film is kept paused, so it never reaches its
  // end (eight seconds), where Return it now gives way to the end's choices.
  await page.evaluate(() => document.addEventListener('play', (e) => e.target.pause?.(), true));
  const took = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/films/${film.slug}/screenings` && r.request().method() === 'POST');
  await playButton(page).click();
  expect((await took).status()).toBe(200);
  await page.getByRole('button', { name: 'Return it now' }).click();
  const back = await holdRequests(page, `/api/films/${film.slug}/return`);
  await holdsTheFocus(page, { button: page.getByRole('button', { name: /^(Return it|Returning…)$/ }), held: back, busyWords: 'Returning…', failed: "Couldn't return it just now. Try again in a moment." });
  // Keep it, beside it, was busy too, and works again: the question goes.
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return it now' })).toBeFocused();
});

// Global setup's admin session is every journey's: the held sign-out never reaches the server.
test('in the back office: Sign out keeps the focus while it asks and after it fails, and a double press asks once', async ({ page, context }) => {
  await asAdmin(context);
  await page.goto('/admin/status');
  await expect(page.getByRole('heading', { level: 1, name: 'Status' })).toBeVisible();
  const held = await holdRequests(page, '/api/admin/logout');
  await holdsTheFocus(page, {
    button: page.getByRole('navigation', { name: 'Back office' }).getByRole('button', { name: 'Sign out', exact: true }),
    held,
    busyWords: 'Signing out…',
    failed: "Couldn't sign out. Check your connection and try again.",
  });
  // Still signed in: the back office's own tabs are there.
  await expect(page.getByRole('navigation', { name: 'Back office' }).getByRole('link', { name: 'Tapes', exact: true })).toBeVisible();
});

// A checkbox saved as it is ticked keeps the focus the same way, and a press while it
// saves changes nothing: the box is drawn as it was.
test('in the back office: Show to members keeps the focus while it saves and after it fails, and a second press saves nothing', async ({ page, context }) => {
  await asAdmin(context);
  await page.goto(`/admin/films/${film.id}`);
  const box = page.getByRole('checkbox', { name: /^Show to members/ });
  await expect(box).toBeVisible();
  const was = await box.isChecked();
  const held = await holdRequests(page, `/api/admin/films/${film.id}`, 'PATCH');
  await box.focus();
  await page.keyboard.press(' ');
  await expect.poll(() => held.count, { message: 'the press sent its request' }).toBe(1);
  await expect(box).toHaveAttribute('aria-disabled', 'true');
  await expect(box).not.toHaveAttribute('disabled');
  expect(await focused(box), 'the busy checkbox keeps the focus').toBe(true);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  expect(held.count, 'a press while it saves sends nothing').toBe(1);
  await expect(box).toBeChecked({ checked: was });

  held.letGo();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't reach the server just now, or it had a problem." })).toBeVisible();
  await expect(box).not.toHaveAttribute('aria-disabled', 'true');
  await expect(box).toBeChecked({ checked: was });
  expect(await focused(box), 'after the error, the focus is still on it').toBe(true);
});

// The name menu's Sign out: choosing it closes the menu and gives the focus back to the
// menu's button, which stays busy (and keeps it) while it asks. The held sign-out never
// reaches the server.
test('in the name menu: Sign out gives the focus back to the menu’s button, which keeps it while it asks and after it fails', async ({ page, context }, testInfo) => {
  const name = unique('Busy', testInfo);
  const { cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  await page.goto('/');
  const menu = page.getByRole('button', { name, exact: true });
  await expect(menu).toBeVisible();
  const held = await holdRequests(page, '/api/signout');

  // The arrow up opens the menu on its last item, Sign out.
  await menu.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => held.count, { message: 'the press sent its request' }).toBe(1);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menu).toHaveAttribute('aria-disabled', 'true');
  expect(await focused(menu), 'the menu’s button has the focus, and keeps it while busy').toBe(true);
  await expect(page.locator('#om-busy[role="status"]')).toHaveText('Just a moment…');
  // Pressed again while busy: the menu doesn't open, and nothing more is sent.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(held.count).toBe(1);

  held.letGo();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't sign out." })).toContainText('Check your connection and try again.');
  await expect(menu).not.toHaveAttribute('aria-disabled', 'true');
  expect(await focused(menu), 'after the error, the focus is still on the menu’s button').toBe(true);
  await expect(page.locator('#om-busy')).toHaveText('');
});
