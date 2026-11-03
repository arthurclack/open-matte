// Admin smoke: signing in through the form with the run's password, Films, the
// film, issuing a ticket from its page and finding it under Tickets, the
// projection booth, and Activity filtered by the film. Nothing may throw, and
// nothing may log an error in the console. Every browser.
import { NO_SNAPSHOTS, enterAdminPassword, expect, film, test, unique } from './fixtures.js';

test.use(NO_SNAPSHOTS);

test('the admin signs in, issues a ticket from the film page, and reads Tickets, Status and Activity', async ({ page, newContext }, testInfo) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // Before signing in, the admin asks whether it's signed in and is told no:
    // browsers log that refusal themselves.
    const refusedSessionCheck = /Failed to load resource/.test(msg.text()) && msg.location().url.endsWith('/api/admin/session');
    if (!refusedSessionCheck) consoleErrors.push(`${msg.text()} (${msg.location().url})`);
  });

  await test.step('sign in through the form', async () => {
    await page.goto('/admin');
    await enterAdminPassword(page, page.getByLabel('Admin password'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();
  });

  const label = unique('Smoke', testInfo);
  let link;
  await test.step('Films, the film, and a ticket issued from its page', async () => {
    await page.getByRole('link', { name: new RegExp(film.title) }).click();
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === `/admin/films/${film.id}`);
    await page.getByRole('textbox', { name: 'Who is it for?' }).fill(label);
    await page.getByRole('button', { name: 'Issue ticket for anyone with the link' }).click();
    const issued = page.locator('.notice.good').filter({ hasText: '1 ticket ready.' });
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

  await test.step('the ticket is under Tickets', async () => {
    await page.getByRole('link', { name: 'Tickets', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: label }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(film.title);
    await expect(row).toContainText('Anyone with the link');
  });

  await test.step('Status: the projection booth', async () => {
    await page.getByRole('link', { name: 'Status', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projection booth' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Needs attention' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The server' })).toBeVisible();
  });

  await test.step('Activity, filtered by the film', async () => {
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Film' }).selectOption({ label: film.title });
    await expect(page).toHaveURL((url) => url.searchParams.get('film') === String(film.id));
    await page.getByRole('button', { name: 'Viewing' }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('kind') === 'viewing' && url.searchParams.get('film') === String(film.id));
    await expect(page.getByRole('button', { name: 'Viewing' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('row').filter({ hasText: label })).not.toHaveCount(0);
    // The filter survives a reload.
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Film' })).toHaveValue(String(film.id));
  });

  expect(consoleErrors, 'errors in the console').toEqual([]);
});
