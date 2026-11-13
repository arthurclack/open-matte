// The passkey pages in a real browser, and what they keep to themselves:
// - a setup link's token leaves the address at once, is kept for this tab only, and
//   goes once it's used, once the page says this device already has a passkey, and
//   on signing out;
// - a ticket for one person keeps its code in /t/ until that person signs in, signed
//   out or signed in as someone else, and the film's page then replaces it;
// - neither ever reaches another address, a request, a Referer or the server's log;
// - a refused attempt offers Copy link (an app's built-in browser that isn't on the
//   list refuses every time), or on a film page, with no code left to copy, says to
//   open the link you were sent; a browser with no passkeys gets Copy link at once;
// - an attempt the cinema refused gets a fresh challenge before the next one, which
//   then works.
// e2e/account.spec.js has keeping from a signed-in browser, and the account page.
//
// Chromium and Chrome only: virtual passkey authenticators are a Chrome DevTools
// Protocol feature, which Firefox and WebKit don't offer.
import fs from 'node:fs';
import { admin, cinemaName, expect, film, signedInPerson, test, unique } from './fixtures.js';

const CHROMIUM_ONLY = 'virtual passkey authenticators come from the Chrome DevTools Protocol, which only Chromium-based browsers have';

test.skip(({ browserName }) => browserName !== 'chromium', CHROMIUM_ONLY);

// ------------------------------------------------------------ helpers

// A passkey provider built into this page's browser: it answers every request at
// once, as if the person had used Touch ID.
async function passkeys(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  });
  return {
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
    // A synced copy of passkeys made elsewhere.
    add: async (credentials) => {
      for (const credential of credentials) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
    },
    // Its answers fail the server's checks (a bad signature, no user presence) until
    // called again with {}.
    spoil: (bits) => cdp.send('WebAuthn.setResponseOverrideBits', { authenticatorId, isBogusSignature: false, isBadUV: false, isBadUP: false, ...bits }),
    // What this tab's Back and Forward hold.
    history: async () => (await cdp.send('Page.getNavigationHistory')).entries.map((e) => e.url),
  };
}

// Every address this page showed or asked for, and every Referer it sent.
function addresses(page) {
  const seen = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) seen.push(frame.url());
  });
  page.on('request', async (req) => {
    seen.push(req.url());
    const referer = (await req.allHeaders().catch(() => ({}))).referer;
    if (referer) seen.push(`Referer: ${referer}`);
  });
  return { containing: (secret) => [...new Set(seen.filter((a) => a.includes(secret)))] };
}

// The challenges the cinema handed this page, and the ones its browser signed.
function challenges(page) {
  const offered = [];
  const signed = [];
  page.on('response', async (res) => {
    if (/^\/api\/(signin|enroll)\/options$/.test(new URL(res.url()).pathname) && res.ok()) offered.push((await res.json()).options.challenge);
  });
  page.on('request', (req) => {
    if (!/^\/api\/(signin|enroll)\/finish$/.test(new URL(req.url()).pathname)) return;
    const clientData = req.postDataJSON().credential.response.clientDataJSON;
    signed.push(JSON.parse(Buffer.from(clientData, 'base64url').toString('utf8')).challenge);
  });
  return { offered, signed };
}

// The browser says no to the next passkey request, as cancelling would, and as an
// app's built-in browser does every time.
const refuseOnce = (page, method) =>
  page.evaluate((m) => {
    const real = navigator.credentials[m].bind(navigator.credentials);
    navigator.credentials[m] = () => {
      navigator.credentials[m] = real;
      return Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
    };
  }, method);

const serverLog = () => fs.readFileSync(process.env.E2E_SERVER_LOG, 'utf8');
const keptLink = (page) => page.evaluate(() => sessionStorage.getItem('om_enroll'));
const menu = (page, name) => page.getByRole('button', { name, exact: true });

// A person, set up with a passkey in this page's browser from their setup link, and
// signed in there.
async function enrollThrough(page, name) {
  const person = await admin.newPerson(name);
  await page.goto(await admin.setupLink(person.id));
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Your membership card is ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(menu(page, name)).toBeVisible();
  return person;
}

async function signOut(page, name) {
  await menu(page, name).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(menu(page, name)).toBeHidden();
}

// ------------------------------------------------------------ the journeys

test('a setup link: the token leaves the address, stays in this tab until it is used, and goes nowhere else', async ({ page }, testInfo) => {
  const name = unique('Ada', testInfo);
  const person = await admin.newPerson(name);
  const link = await admin.setupLink(person.id);
  const token = new URL(link).hash.slice(1);
  const auth = await passkeys(page);
  const seen = addresses(page);

  await test.step('opening it clears the token from the address and keeps it for this tab', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === '/enroll' && url.hash === '');
    expect(await keptLink(page)).toBe(token);
    expect(await auth.history()).not.toContainEqual(expect.stringContaining(token));
  });

  await test.step('a reload carries on from the copy this tab kept', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  });

  await test.step('creating the passkey uses the link up, and the tab lets it go', async () => {
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your membership card is ready' })).toBeVisible();
    expect(await keptLink(page)).toBeNull();
  });

  await test.step('the token was only ever in the link as opened', async () => {
    expect(seen.containing(token)).toEqual([link]);
    expect(serverLog()).not.toContain(token);
  });
});

test('a ticket for one person keeps its code in /t/ until they sign in, then the film page replaces it', async ({ page, context }, testInfo) => {
  const name = unique('Sam', testInfo);
  const auth = await passkeys(page);
  const person = await enrollThrough(page, name);
  await signOut(page, name);
  const ticket = await admin.issueTicket({ personId: person.id });
  const at = `/t/${ticket.code}`;
  const seen = addresses(page);

  await test.step('signed out: a sign-in page at the same address, with no cookie and no way to /signin', async () => {
    await page.goto(at);
    await expect(page.getByRole('heading', { name: 'Show your card' })).toBeVisible();
    await expect(page.getByText('This tape is for one member')).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === at && url.search === '');
    expect((await context.cookies()).map((c) => c.name)).not.toContain('om_session');
    await expect(page.locator('a[href*="/signin"]')).toHaveCount(0);
  });

  await test.step('a refused attempt says so, stays put, and offers Copy link with the code', async () => {
    await refuseOnce(page, 'get');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByText('Cancelled or timed out. Try again.')).toBeVisible();
    await expect(page.getByText('Inside an app? Open this in Safari or Chrome')).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === at);
    await page.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => window.__copied)).toBe(new URL(at, page.url()).href);
  });

  await test.step('signing in opens the ticket, and the film page takes the place of /t/<code>', async () => {
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === `/${film.slug}`);
    await expect(menu(page, name)).toBeVisible();
    expect(await auth.history()).not.toContainEqual(expect.stringContaining(ticket.code));
  });

  await test.step('the code was in no other address, request, Referer or log line', async () => {
    expect(seen.containing(ticket.code)).toEqual([new URL(at, page.url()).href]);
    expect(serverLog()).not.toContain(ticket.code);
  });
});

test('a ticket for one person, opened while signed in as someone else', async ({ page, newContext }, testInfo) => {
  const name = unique('Sam', testInfo);
  const auth = await passkeys(page);
  const person = await enrollThrough(page, name);
  const ticket = await admin.issueTicket({ personId: person.id });
  const at = `/t/${ticket.code}`;

  // Another browser, signed in as Kit, that also has a synced copy of Sam's passkey.
  const kitName = unique('Kit', testInfo);
  const kit = await signedInPerson(kitName);
  const context = await newContext();
  await context.addCookies([kit.cookie]);
  const other = await context.newPage();
  await (await passkeys(other)).add(await auth.credentials());

  await test.step('it says the ticket is for someone else, and the code stays in the address', async () => {
    await other.goto(at);
    await expect(other.getByRole('heading', { name: 'This tape is for someone else' })).toBeVisible();
    await expect(other.getByText(`You're signed in as ${kitName}.`)).toBeVisible();
    await expect(other).toHaveURL((url) => url.pathname === at);
  });

  await test.step('signing out there leads to signing in, at the same address', async () => {
    await other.getByRole('button', { name: 'Sign out' }).click();
    await expect(other.getByRole('heading', { name: 'Show your card' })).toBeVisible();
    await expect(menu(other, kitName)).toBeHidden();
    await expect(other).toHaveURL((url) => url.pathname === at && url.search === '');
  });

  await test.step('signing in as the person opens the film, and the code leaves the address', async () => {
    await other.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(other.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(other).toHaveURL((url) => url.pathname === `/${film.slug}`);
    await expect(menu(other, name)).toBeVisible();
  });
});

test('a passkey or sign-in the cinema refuses gets a fresh challenge before the next try, which then works', async ({ page }, testInfo) => {
  const name = unique('Lin', testInfo);
  const person = await admin.newPerson(name);
  const auth = await passkeys(page);
  const seen = challenges(page);

  await test.step('creating: refused once (no user presence), then created', async () => {
    await page.goto(await admin.setupLink(person.id));
    await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
    await auth.spoil({ isBadUP: true });
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByText("Your passkey couldn't be checked. Try again.")).toBeVisible();
    await auth.spoil({});
    // The button waits for fresh options: the server has taken the first challenge.
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your membership card is ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(menu(page, name)).toBeVisible();
  });

  await signOut(page, name);
  const before = { offered: seen.offered.length, signed: seen.signed.length };

  await test.step('signing in: refused once (a bad signature), then signed in', async () => {
    await page.goto('/signin');
    await auth.spoil({ isBogusSignature: true });
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    // With no "Your name" set, whom to ask is the shop, by its name.
    await expect(page.getByText(`That passkey didn't work. Try again, or ask ${cinemaName()}.`, { exact: true })).toBeVisible();
    await auth.spoil({});
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(menu(page, name)).toBeVisible();
    await expect(page).toHaveURL((url) => url.pathname === '/');
  });

  await test.step('no challenge was signed twice, and each was one the cinema had just offered', async () => {
    for (const signed of [seen.signed.slice(0, before.signed), seen.signed.slice(before.signed)]) {
      expect(signed).toHaveLength(2);
      expect(new Set(signed).size).toBe(2);
    }
    for (const c of seen.signed) expect(seen.offered).toContain(c);
    expect(seen.offered.length - before.offered).toBeGreaterThanOrEqual(2);
  });
});

test('the "already have a passkey" page and signing out let a setup link go from this tab', async ({ page }, testInfo) => {
  const name = unique('Noor', testInfo);
  await passkeys(page);
  const person = await enrollThrough(page, name);
  // Add a sign-in method: a recovery link that keeps the passkey this browser has.
  const { link } = await admin.post(`/api/admin/people/${person.id}/links`, { confirmedContact: true });

  await test.step('this device already has the passkey: the page says so, and the tab lets the link go', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Welcome back, ${name}` })).toBeVisible();
    expect(await keptLink(page)).not.toBeNull();
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByRole('heading', { name: 'You already have a passkey' })).toBeVisible();
    await expect(page.getByText('This phone or computer already has your passkey')).toBeVisible();
    expect(await keptLink(page)).toBeNull();
  });

  await test.step('opened again and then signed out: the link goes, and Back finds nothing to finish', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Welcome back, ${name}` })).toBeVisible();
    expect(await keptLink(page)).not.toBeNull();
    await signOut(page, name);
    await expect(page).toHaveURL((url) => url.pathname === '/');
    expect(await keptLink(page)).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/enroll');
    await expect(page.getByRole('heading', { name: 'Open your link again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a passkey' })).toHaveCount(0);
  });

  await test.step('Sign out everywhere, from the account page, lets it go too', async () => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expect(menu(page, name)).toBeVisible();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Welcome back, ${name}` })).toBeVisible();
    expect(await keptLink(page)).not.toBeNull();
    await menu(page, name).click();
    await page.getByRole('menuitem', { name: 'Your membership card' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(menu(page, name)).toBeHidden();
    expect(await keptLink(page)).toBeNull();
  });
});

test("after a refused attempt, Copy link on /enroll puts the whole setup link back together", async ({ page }, testInfo) => {
  const name = unique('Ola', testInfo);
  const person = await admin.newPerson(name);
  const link = await admin.setupLink(person.id);
  await passkeys(page);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  await expect(page).toHaveURL((url) => url.hash === '');

  await refuseOnce(page, 'create');
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByText('Cancelled or timed out. Try again.')).toBeVisible();
  await expect(page.getByText('Inside an app? Open this in Safari or Chrome')).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  expect(await page.evaluate(() => window.__copied)).toBe(link);

  // The cinema never saw the refused attempt, so its challenge still works.
  await page.getByRole('button', { name: 'Create a passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Your membership card is ready' })).toBeVisible();
});

test('after a refused attempt, Sign in and keep it says to open the link you were sent: the film page has no code to copy', async ({ page }, testInfo) => {
  const name = unique('Pia', testInfo);
  await passkeys(page);
  await enrollThrough(page, name);
  await signOut(page, name);
  const ticket = await admin.issueTicket({ label: unique('Keep after refusal', testInfo), claimable: true });

  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in and keep it' }).click();
  await refuseOnce(page, 'get');
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Cancelled or timed out. Try again.')).toBeVisible();
  await expect(page.getByText('Inside an app? Its browser may not be able to use passkeys: open the link you were sent in Safari or Chrome')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Copy/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  // Kept: the "For … only" strip under the title says it's on their card (question 11:
  // the page no longer says "This tape is on your card", 1.1.0's words).
  await expect(page.locator('.fl-for .ob-sr').first()).toHaveText(/^For /);
  await expect(menu(page, name)).toBeVisible();
});

test("a browser that can't use passkeys leaves a setup link and a ticket for one person whole, for Copy link", async ({ newContext }, testInfo) => {
  const context = await newContext();
  await context.addInitScript(() => {
    delete window.PublicKeyCredential;
  });
  const page = await context.newPage();
  const person = await admin.newPerson(unique('Ivo', testInfo));
  const link = await admin.setupLink(person.id);
  const ticket = await admin.issueTicket({ personId: person.id });

  await test.step('the setup link stays in the address, nothing is kept, and Copy link copies all of it', async () => {
    await page.goto(link);
    await expect(page.getByText('Open this in Safari or Chrome')).toBeVisible();
    expect(page.url()).toBe(link);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    await page.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => window.__copied)).toBe(link);
  });

  await test.step('the tape offers Copy link, with its code still in the address', async () => {
    await page.goto(`/t/${ticket.code}`);
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/t/${ticket.code}`);
    expect(await page.evaluate(() => window.__copied)).toBe(page.url());
  });
});
