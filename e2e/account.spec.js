// Passkeys and keeping: a person enrols from a setup link with a virtual
// authenticator, signs out and back in with the passkey, and keeps a ticket for
// anyone that another browser opened first; that browser is told on its next
// request, and the account page lists this one. (In 1.x the other browser played it
// first. A link is kept only before Play, while its tape is in: version 2, question 2.)
//
// Chromium and Chrome only: virtual authenticators are a Chrome DevTools
// Protocol feature, which Firefox and WebKit don't offer.
import { admin, expect, film, playButton, test, unique } from './fixtures.js';

const CHROMIUM_ONLY = 'virtual passkey authenticators come from the Chrome DevTools Protocol, which only Chromium-based browsers have';

test.skip(({ browserName }) => browserName !== 'chromium', CHROMIUM_ONLY);

test('a passkey set up from a link signs in, keeps a ticket, and shows on the account page', async ({ page, context, newContext }, testInfo) => {
  const name = unique('Ada', testInfo);
  const person = await admin.newPerson(name);
  const setupLink = await admin.setupLink(person.id);
  const menu = page.getByRole('button', { name, exact: true });

  // A passkey provider built into this browser: it answers every request at once,
  // as if the person had used Touch ID.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;

  await test.step('the setup link creates a passkey and signs in', async () => {
    await page.goto(setupLink);
    await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
    // The token leaves the address as soon as it's read.
    await expect(page).toHaveURL((url) => url.pathname === '/enroll' && url.hash === '');
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your membership card is ready' })).toBeVisible();
    expect(await credentials()).toHaveLength(1);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(menu).toBeVisible();
  });

  await test.step('signing out, then in again with the passkey', async () => {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(menu).toBeHidden();

    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });

  const ticket = await admin.issueTicket({ label: unique('Keepable', testInfo), claimable: true });
  const other = await (await newContext()).newPage();

  await test.step('another browser, not signed in, opens the link, and is offered Play', async () => {
    await other.goto(`/t/${ticket.code}`);
    await expect(other.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    // Opening took nothing: the tape is in, so the link can still be kept.
    await expect(playButton(other)).toHaveAccessibleName('Play');
  });

  await test.step('the signed-in browser opens the same link and keeps it', async () => {
    await page.goto(`/t/${ticket.code}`);
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByText("This tape is on your card, so it's on every device you sign in on.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep it' })).toBeHidden();
  });

  await test.step('the other browser is told it has been kept', async () => {
    await other.reload();
    await expect(other.getByRole('heading', { name: 'This tape has been kept' })).toBeVisible();
  });

  await test.step('the account page lists this browser and the passkey', async () => {
    await menu.click();
    await page.getByRole('menuitem', { name: 'Your membership card' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your membership card' })).toBeVisible();
    const browsers = page.locator('h2:has-text("Signed in on") + ul > li');
    await expect(browsers.filter({ hasText: 'This browser' })).toHaveCount(1);
    await expect(browsers.filter({ hasText: 'This browser' })).toContainText(/Chrome on \w+/);
    await expect(page.getByText('Used to sign in here')).toBeVisible();
  });
});
