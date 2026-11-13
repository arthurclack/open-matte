// What the admin is told when something goes wrong, and Reset to film.json: the
// sign-in form blames the password only when the server says it's wrong, giving a
// ticket to someone disabled since the page opened says so in words, and Reset to
// film.json appears only once there's an edit to undo. Every browser, but Reset to
// film.json only in chromium: it edits a film that every browser's journeys share,
// and what it checks is the admin page's wiring, not anything a browser does its way.
import { NO_SNAPSHOTS, admin, expect, secondFilm, test, unique } from './fixtures.js';

test.use(NO_SNAPSHOTS);

// Signed in with global setup's admin session, without the form.
async function asAdmin(context, baseURL) {
  const value = process.env.E2E_ADMIN_COOKIE.split('; ').find((c) => c.startsWith('om_admin=')).slice('om_admin='.length);
  await context.addCookies([{ name: 'om_admin', value, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
}

test('the sign-in form says the password is wrong only when it is', async ({ page }) => {
  // The answers are made up here, so no try counts against the password's limit,
  // and the text typed is not the password.
  let answer = 401;
  await page.route('**/api/admin/login', (route) => {
    if (answer === 'offline') return route.abort('internetdisconnected');
    // A 502 is what Caddy says while a deploy restarts the app: not JSON at all.
    const body = { 401: { error: 'wrong-password' }, 429: { error: 'too-many-requests' }, 500: { error: 'server-error' } }[answer];
    return route.fulfill(body ? { status: answer, json: body } : { status: answer, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
  });
  await page.goto('/admin');
  await page.getByLabel('Back office password').fill('not the password');

  const WRONG = 'That password is not right.';
  const UNREACHED = "Couldn't sign in just now. Check your connection and try again in a moment.";
  // Each answer's message differs from the one before, so each is seen anew.
  for (const [status, message] of [[401, WRONG], [502, UNREACHED], [429, 'Too many attempts. Wait a few minutes and try again.'], ['offline', UNREACHED], [401, WRONG], [500, UNREACHED]]) {
    answer = status;
    const sent = page.waitForRequest('**/api/admin/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await sent;
    await expect(page.locator('.admin-login [role="alert"]'), String(status)).toHaveText(message);
  }
});

test('giving a link to someone whose card was turned off since the page opened says so in words', async ({ page, context, baseURL }, testInfo) => {
  await asAdmin(context, baseURL);
  const person = await admin.newPerson(unique('Dana', testInfo));
  const ticket = await admin.issueTicket({ label: unique('Give', testInfo) });
  await page.goto(`/admin/tickets/${ticket.id}`);
  await page.getByRole('combobox', { name: 'Give it to' }).selectOption({ label: person.name });
  // In another tab, as it were.
  await admin.post(`/api/admin/people/${person.id}/disable`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Give', exact: true }).click();
  await expect(page.locator('.ui-line--bad')).toHaveText('Their card is turned off: turn it back on, on their page, before giving them a link.');
  await expect(page.getByText('Anyone with the link.', { exact: true })).toBeVisible();
});

test('Reset to film.json appears once a field is edited, and puts it back', async ({ page, context, baseURL }, testInfo) => {
  // Projects run side by side against one server: two of these at once would see each other's edit.
  test.skip(testInfo.project.name !== 'chromium', 'edits a film every browser shares, so it runs in the chromium project only');
  await asAdmin(context, baseURL);
  await page.goto(`/admin/films/${secondFilm.id}`);
  // The details are the film page's second tab.
  await page.getByRole('tab', { name: 'Details' }).click();
  const reset = page.getByRole('button', { name: 'Reset to film.json' });
  const country = page.getByRole('textbox', { name: /^Country/ });
  await expect(country).toHaveValue('');
  await expect(reset).toHaveCount(0);

  await country.fill('Testland');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await expect(page.locator('.ui-field').filter({ has: country }).locator('.of-src')).toHaveText('edited here');
  await expect(reset).toBeVisible();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Replace your edits with the values from film.json? What TMDB filled in stays as it is.');
    dialog.accept();
  });
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(country).toHaveValue('');
});
