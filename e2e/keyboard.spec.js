// Keyboard only: the film page (Tab to Play, Enter, focus on the video, Space
// pauses), the name menu (Enter opens it, Escape closes it, focus back on its
// button), and the admin's sign-in and Settings. Every browser; Space only where
// the film plays, and not in WebKit. The name menu's person is signed in through
// the API with a software passkey, so it runs in every browser too.
import {
  NO_SNAPSHOTS,
  admin,
  enterAdminPassword,
  expect,
  film,
  focusedTag,
  media,
  playbackSupport,
  signedInPerson,
  tabTo,
  test,
  unique,
} from './fixtures.js';

// The admin's sign-in puts the run's password in a form field, and trace
// snapshots would keep it: none in this file.
test.use(NO_SNAPSHOTS);

// Opens a fresh ticket's film page and starts it from the keyboard alone.
async function playFromKeyboard(page, testInfo) {
  const ticket = await admin.issueTicket({ label: unique('Keyboard', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: /Play/ }));
  const started = page.waitForResponse((r) => r.url().endsWith(`/api/films/${film.slug}/screenings`) && r.request().method() === 'POST');
  await page.keyboard.press('Enter');
  expect((await started).status()).toBe(200);
  await expect(page.locator('video')).toBeVisible();
}

test('on the film page, Tab reaches Play, Enter starts it, and focus moves to the video', async ({ page }, testInfo) => {
  await playFromKeyboard(page, testInfo);
  // Pressing Play removes the button; the player takes focus, so the keyboard
  // carries on there rather than at the top of the page.
  await expect.poll(() => focusedTag(page), { message: 'focus moves to the video' }).toBe('video');
  const support = await playbackSupport(page);
  if (support.canPlay) await media.playedPast(page, 0.5);
  else testInfo.annotations.push({ type: 'skipped check', description: `playing: ${support.why}` });
});

test('Space pauses the film once the video has focus', async ({ page, browserName }, testInfo) => {
  // In WebKit a focused <video> leaves Space to the page, which scrolls (and the
  // arrow keys don't seek). Whether Mac Safari does the same is the "Mac Safari,
  // keyboard only" device check.
  test.skip(browserName === 'webkit', "WebKit's video doesn't take Space from the keyboard: the page scrolls instead");
  await playFromKeyboard(page, testInfo);
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);
  await expect.poll(() => focusedTag(page)).toBe('video');
  await media.playedPast(page, 0.5);
  await page.keyboard.press('Space');
  // Paused by the key, not by reaching the end of the film.
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.paused && !v.ended), { timeout: 3000, message: 'Space pauses' })
    .toBe(true);
});

// Signs a new person in with a software passkey, through the API, and opens the front page.
async function signedInFrontPage(page, context, testInfo) {
  const name = unique('Grace', testInfo);
  const { cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  await page.goto('/');
  return page.getByRole('button', { name: `${name} ▾` });
}

test('the name menu opens with Enter and closes with Escape, focus staying on its button', async ({ page, context }, testInfo) => {
  const button = await signedInFrontPage(page, context, testInfo);
  await tabTo(page, button);

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem')).toHaveText(['Your tickets', 'Your account', 'Sign out']);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
});

test('Escape from inside the name menu puts focus back on its button', async ({ page, context }, testInfo) => {
  // Known: the menu closes, but focus falls to the page (web/src/site.jsx,
  // PersonMenu). Remove this line once it's fixed: the test then has to pass.
  test.fail(true, 'focus falls to <body> when Escape closes the menu from one of its items');
  const button = await signedInFrontPage(page, context, testInfo);
  await tabTo(page, button);
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('menuitem', { name: 'Your tickets' }), { max: 1 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(button).toBeFocused({ timeout: 2000 });
});

test('the admin sign-in and Settings work from the keyboard', async ({ page }, testInfo) => {
  await page.goto('/admin');
  const password = page.getByLabel('Admin password');
  // The password field has focus from the start, and Enter signs in.
  await expect(password).toBeFocused();
  await enterAdminPassword(page, password);
  await expect(password).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();

  await tabTo(page, page.getByRole('link', { name: 'Settings' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  const welcome = unique('Typed at the keyboard in', testInfo);
  const message = page.getByLabel('Front page message');
  await expect(message).not.toHaveValue('');
  await tabTo(page, message);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(welcome);
  await expect(message).toHaveValue(welcome);

  const poweredBy = page.getByRole('checkbox', { name: /Powered by Open Matte/ });
  const wasChecked = await poweredBy.isChecked();
  await tabTo(page, poweredBy);
  await page.keyboard.press('Space');
  await expect(poweredBy).toBeChecked({ checked: !wasChecked });

  const save = page.getByRole('button', { name: 'Save settings' });
  await tabTo(page, save);
  const saved = page.waitForRequest((r) => r.url().endsWith('/api/admin/settings') && r.method() === 'PATCH');
  await page.keyboard.press('Enter');
  expect((await saved).postDataJSON()).toMatchObject({ welcome, poweredBy: !wasChecked });
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
});
