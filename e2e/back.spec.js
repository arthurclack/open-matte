// Back after signing out, on a shared computer: the pages from before don't come
// back as they were, from the browser's back/forward cache, and the API's answers
// aren't in its HTTP cache either. In the admin (its ticket links are bearer
// tickets) and on the viewer site. The chromium project only: Playwright turns the
// back/forward cache off in every browser, and only Chromium's can be turned back on.
import { NO_SNAPSHOTS, admin, cinemaName, expect, signInAsAdmin, signedInPerson, test, unique } from './fixtures.js';

const ONLY_HERE = "only Chromium's back/forward cache can be turned back on under Playwright: these run in the chromium project";
test.skip(({ browserName }) => browserName !== 'chromium', ONLY_HERE);
// The chrome project's Chrome would be swapped for Playwright's Chromium by the line below.
test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'chromium', ONLY_HERE));
// A real browser has the back/forward cache on: Playwright's Chromium in full (its
// headless shell has none), without the switch Playwright adds to turn it off. And no
// trace snapshots: the admin's sign-in puts the run's password in a form field.
test.use({ ...NO_SNAPSHOTS, channel: 'chromium', launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] } });

// How many times this tab has had a page brought back from the back/forward cache.
// Counted before the page's own scripts run, and kept across the reload that follows.
const countRestores = (context) =>
  context.addInitScript(() => {
    addEventListener('pageshow', (e) => {
      if (e.persisted) sessionStorage.setItem('restored', String(Number(sessionStorage.getItem('restored') ?? 0) + 1));
    });
  });
const restores = (page) => page.evaluate(() => Number(sessionStorage.getItem('restored') ?? 0));
// Back until the tab is at `pathname`: React Router may have added an entry of its own.
// A page that loads afresh fires its load event, which Back waits for; a page brought
// back from the cache just as it was fires none, so Back isn't waited for longer than
// loading would take. Either way, what the page then shows is checked after.
async function backTo(page, pathname) {
  const at = () => new URL(page.url()).pathname;
  for (let i = 0; i < 3 && at() !== pathname; i++) {
    await page.goBack({ timeout: 5000 }).catch((err) => {
      if (err.name !== 'TimeoutError') throw err;
    });
  }
  expect(at()).toBe(pathname);
}
const cached = (page, url) =>
  page.evaluate((u) => fetch(u, { cache: 'only-if-cached', mode: 'same-origin' }).then((r) => r.status, () => 'not in the cache'), url);

test("in the admin: the earlier pages don't come back, nor do their answers from the cache", async ({ page, context }, testInfo) => {
  await countRestores(context);
  const label = unique('Bearer', testInfo);
  await admin.issueTicket({ label });
  await page.goto('/admin');
  await signInAsAdmin(page, () => page.getByRole('button', { name: 'Sign in' }).click());
  await page.getByRole('link', { name: 'Tickets', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: label })).toHaveCount(1);
  // As the owner would leave it: the viewer site, then back into the admin, then Sign out.
  await page.getByRole('link', { name: 'View site' }).click();
  await expect(page.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
  await page.locator('header').getByRole('link', { name: 'Admin' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();
  await page.locator('.admin-nav').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open Matte admin' })).toBeVisible();

  await backTo(page, '/admin/tickets');
  await expect(page.getByRole('heading', { name: 'Open Matte admin' })).toBeVisible();
  expect(await restores(page), 'the browser brought pages back from its back/forward cache').toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  await expect(page.getByText(label)).toHaveCount(0);
  for (const url of ['/api/admin/tickets', '/api/admin/people', '/api/admin/session']) expect(await cached(page, url), url).toBe('not in the cache');
});

test("on the viewer site: Your account doesn't come back signed in", async ({ page, context }, testInfo) => {
  await countRestores(context);
  const name = unique('Sam', testInfo);
  const { cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  const menu = (p) => p.getByRole('button', { name, exact: true });
  await page.goto('/account');
  await expect(page.getByText('Signed in here with this')).toBeVisible();
  // Another page, then Sign out there.
  await page.goto('/');
  await menu(page).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

  await backTo(page, '/account');
  await expect(page.getByText('Sign in to see your passkeys')).toBeVisible();
  expect(await restores(page), 'the browser brought the page back from its back/forward cache').toBeGreaterThan(0);
  await expect(menu(page)).toBeHidden();
  await expect(page.getByText('Signed in here with this')).toHaveCount(0);
  for (const url of ['/api/account', '/api/me']) expect(await cached(page, url), url).toBe('not in the cache');
});
