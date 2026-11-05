// The membership card (web/src/MembershipCard.jsx), in real browsers: on the account
// page, front up, with a Turn over button that works from the keyboard; the side
// facing down hidden from screen readers and out of reach; an instant swap for
// someone who asked for less motion; its fonts from this site; a barcode that reads
// back as the number. And on the page that makes a passkey, back up, with the name
// written on. Every journey here also fails on anything the Content-Security-Policy
// blocks (fixtures.js): the card draws its paper on canvases and its ink with SVG
// filters, and its fonts come from this site.
import { admin, cinemaName, exclusively, expect, signedInPerson, tabTo, test, unique } from './fixtures.js';

const grouped = (n) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

// Codabar from its specification, to read the drawn barcode back: 1 for a wide element.
const SPEC = {
  0: '0000011', 1: '0000110', 2: '0001001', 3: '1100000', 4: '0010010', 5: '1000010', 6: '0100001', 7: '0100100', 8: '0110000', 9: '1001000',
  A: '0011010', B: '0101001', C: '0001011', D: '0001110',
};
const BY_PATTERN = Object.fromEntries(Object.entries(SPEC).map(([ch, p]) => [p, ch]));
function decode(rects) {
  const bars = [...rects].sort((a, b) => a[0] - b[0]);
  const runs = [];
  bars.forEach(([x, w], i) => {
    if (i) runs.push(x - (bars[i - 1][0] + bars[i - 1][1]));
    runs.push(w);
  });
  const cut = (Math.min(...runs) + Math.max(...runs)) / 2;
  let out = '';
  for (let k = 0; k < runs.length; k += 8) out += BY_PATTERN[runs.slice(k, k + 7).map((r) => (r > cut ? '1' : '0')).join('')] ?? '?';
  return out;
}

// The two sides, as a screen reader finds them.
const sides = (page) => ({
  front: page.getByRole('img', { name: `${cinemaName()} membership card, front` }),
  back: page.getByRole('group', { name: `${cinemaName()} membership card, back` }),
});
const faces = (page) =>
  page.locator('.mc-face').evaluateAll((els) =>
    els.map((el) => ({ hidden: el.getAttribute('aria-hidden'), inert: el.hasAttribute('inert'), visibility: getComputedStyle(el).visibility })),
  );

async function signedIn(context, testInfo) {
  const name = unique('Card', testInfo);
  const { person, cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  return { name, number: person.membership.number };
}

test('the account page shows the membership card, front up, and Turn over turns it from the keyboard', async ({ page, context }, testInfo) => {
  const { name, number } = await signedIn(context, testInfo);
  const fonts = [];
  page.on('response', (r) => new URL(r.url()).pathname.startsWith('/fonts/') && fonts.push(`${new URL(r.url()).pathname} ${r.status()}`));
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 2, name: 'Your membership card' })).toBeVisible();
  const { front, back } = sides(page);

  await test.step('front up: the shop, and the back hidden from everyone', async () => {
    await expect(front).toBeVisible();
    await expect(back).toHaveCount(0);
    await expect(page.locator('.mc-shop')).toContainText(cinemaName());
    await expect(page.locator('.mc-kind')).toHaveText('Membership card');
    expect(await faces(page)).toEqual([
      { hidden: null, inert: false, visibility: 'visible' },
      { hidden: 'true', inert: true, visibility: 'hidden' },
    ]);
    // ID-1: 85.6 by 54, 440px wide on a screen this wide (360 under 768px).
    const box = await page.locator('.mc-card--front .mc-sheet').boundingBox();
    expect(box.width).toBeGreaterThan(420);
    expect(box.width).toBeLessThanOrEqual(440);
    expect(box.width / box.height).toBeCloseTo(85.6 / 54, 1);
  });

  await test.step('Turn over, from the keyboard', async () => {
    const button = page.getByRole('button', { name: 'Turn over' });
    await tabTo(page, button);
    await page.keyboard.press('Enter');
    await expect(back).toBeVisible();
    await expect(front).toHaveCount(0);
    // It turned: it moves for a moment, then lies still.
    await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
    expect(await faces(page)).toEqual([
      { hidden: 'true', inert: true, visibility: 'hidden' },
      { hidden: null, inert: false, visibility: 'visible' },
    ]);
    await expect(button).toBeFocused();
    await expect(page.locator('.mc [aria-live]')).toHaveText('The back of the card');
  });

  await test.step('the back: the name, member since, the number after its label, the small print', async () => {
    await expect(back).toContainText(name);
    await expect(back).toContainText('Member since');
    // Typed "Nov 2026" on the card; said in full, "November 2026", in UTC as the admin's page has it.
    const now = new Date();
    const month = (style) => new Intl.DateTimeFormat('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' }).format(now);
    await expect(back.locator('.mc-since .visually-hidden')).toHaveText(month('long'));
    await expect(back.locator('.mc-since [aria-hidden]')).toHaveText(month('short').replace('Sept', 'Sep'));
    // Read once, beside its label; the barcode label is for a scanner.
    await expect(back.locator('.mc-numk')).toHaveText(`Membership number ${grouped(number)}`);
    await expect(back.locator('.mc-bar')).toHaveAttribute('aria-hidden', 'true');
    await expect(back.locator('.mc-small')).toHaveText(`This card belongs to ${cinemaName()}. If you find it, please hand it back.`, { useInnerText: true });
    await expect(back.locator('.mc-digits')).toHaveText(grouped(number));
  });

  await test.step('the barcode is the number in Codabar, in whole device pixels', async () => {
    const svg = back.locator('svg.mc-codabar');
    await expect(svg).toHaveAttribute('data-code', `A${number}B`);
    await expect(svg).toHaveAttribute('data-snap', /^\d+:\d+@/);
    // Wide bars at least 2.25 narrow ones, as Codabar asks of bars this thin.
    const [n, w] = (await svg.getAttribute('data-snap')).split('@')[0].split(':').map(Number);
    expect(w / n).toBeGreaterThanOrEqual(2.25);
    const rects = await svg.evaluate((el) => [...el.querySelectorAll('rect')].map((r) => [+r.getAttribute('x'), +r.getAttribute('width')]));
    expect(rects.every(([x, w]) => Number.isInteger(x) && Number.isInteger(w))).toBe(true);
    expect(decode(rects)).toBe(`A${number}B`);
  });

  await test.step('its fonts, from this site', async () => {
    await page.evaluate(() => document.fonts.ready);
    for (const face of ['800 16px Fraunces', '16px "Grape Nuts"', '16px "Courier Prime"']) {
      expect(await page.evaluate((f) => document.fonts.check(f), face), face).toBe(true);
    }
    expect(fonts.sort()).toEqual(['/fonts/CourierPrime-Regular.ttf 200', '/fonts/Fraunces-Variable.ttf 200', '/fonts/GrapeNuts-Regular.ttf 200']);
  });

  await test.step('and over again, back to the front', async () => {
    await page.keyboard.press('Space');
    await expect(front).toBeVisible();
    await expect(back).toHaveCount(0);
    await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
    await expect(page.locator('.mc [aria-live]')).toHaveText('The front of the card');
  });
});

test('the card turns over in 460 ms, and a second press mid-turn sends it back', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/account');
  const button = page.getByRole('button', { name: 'Turn over' });
  await expect(sides(page).front).toBeVisible();
  const transition = await page.locator('.mc-face--front').evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`;
  });
  expect(transition).toBe('transform 0.46s cubic-bezier(0.25, 0.46, 0.45, 0.94)');
  await button.click();
  await expect(page.locator('.mc')).toHaveClass(/is-turning/);
  // Both sides are drawn while it turns.
  expect((await faces(page)).map((f) => f.visibility)).toEqual(['visible', 'visible']);
  await button.click();
  await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
  await expect(sides(page).front).toBeVisible();
  await expect(sides(page).back).toHaveCount(0);
});

test('with less motion asked for, the sides simply swap', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await expect(sides(page).front).toBeVisible();
  // At once: the same task as the press, with no turning in between.
  const after = await page.getByRole('button', { name: 'Turn over' }).evaluate(async (button) => {
    button.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = button.closest('.mc');
    const [front, back] = root.querySelectorAll('.mc-face');
    return {
      turning: root.classList.contains('is-turning'),
      front: [front.getAttribute('aria-hidden'), getComputedStyle(front).visibility],
      back: [back.getAttribute('aria-hidden'), getComputedStyle(back).visibility, getComputedStyle(back).transform],
      transitions: document.getAnimations().filter((a) => root.contains(a.effect?.target)).length,
    };
  });
  expect(after).toEqual({ turning: false, front: ['true', 'hidden'], back: [null, 'visible', 'none'], transitions: 0 });
  await expect(sides(page).back).toBeVisible();
});

test('the card prints in the shop’s colour, made dark enough to read on it; Open Matte’s own prints blue', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  const ink = async () => ({
    band: await page.locator('.mc-band-ink').evaluate((el) => getComputedStyle(el).backgroundColor),
    name: await page.locator('.mc-shop').evaluate((el) => getComputedStyle(el).color),
  });
  // The cinema's colours are shared by every browser: one journey at a time changes them.
  await exclusively('colours', async () => {
    try {
      await admin.patch('/api/admin/settings', { accentColor: '#e8b04a' });
      await page.goto('/account');
      await expect(sides(page).front).toBeVisible();
      expect(await ink()).toEqual({ band: 'rgb(32, 48, 200)', name: 'rgb(32, 48, 200)' });
      // A pale yellow accent prints darkened to a mustard, keeping its hue.
      await admin.patch('/api/admin/settings', { accentColor: '#f2e8a0' });
      await page.reload();
      await expect(sides(page).front).toBeVisible();
      expect(await ink()).toEqual({ band: 'rgb(78, 70, 3)', name: 'rgb(78, 70, 3)' });
    } finally {
      await admin.patch('/api/admin/settings', { accentColor: '#e8b04a' });
    }
  });
});

test('a name in Arabic is written right to left, its words in its own order', async ({ page, context }) => {
  const name = `محمد علي ${Math.random().toString(36).slice(2, 6)}`;
  const { cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn over' }).click();
  const { back } = sides(page);
  await expect(back).toContainText('محمد علي');
  const v = back.locator('.mc-name .mc-v');
  await expect(v).toHaveAttribute('dir', 'auto');
  expect(await v.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  // The first word, محمد, is the rightmost: a right-to-left reader reads it first.
  const xs = await v.locator('.mc-hw').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
  expect(xs.length).toBe(3);
  expect(xs[0]).toBeGreaterThan(xs[1]);
  expect(xs[1]).toBeGreaterThan(xs[2]);
  // The shop's name finds its own direction too.
  await expect(page.locator('.mc-shop')).toHaveAttribute('dir', 'auto');
});

test.describe('the page that makes a passkey', () => {
  // Virtual authenticators are a Chrome DevTools Protocol feature (passkeys.spec.js).
  test.skip(({ browserName }) => browserName !== 'chromium', 'virtual passkey authenticators come from the Chrome DevTools Protocol, which only Chromium-based browsers have');

  for (const motion of ['no-preference', 'reduce']) {
    test(`ends on the card, back up, with the name ${motion === 'reduce' ? 'simply there (less motion)' : 'written on'}`, async ({ page, context }, testInfo) => {
      const name = unique('Ink', testInfo);
      const person = await admin.newPerson(name);
      const link = await admin.setupLink(person.id);
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
      });
      await page.emulateMedia({ reducedMotion: motion });
      // Every animation the page starts, as it starts: the writing is over in about half a second.
      await context.addInitScript(() => {
        const animate = Element.prototype.animate;
        window.__animated = [];
        Element.prototype.animate = function (keyframes, options) {
          window.__animated.push({ cls: String(this.className), delay: options?.delay ?? 0, duration: options?.duration });
          return animate.call(this, keyframes, options);
        };
      });
      await page.goto(link);
      await page.getByRole('button', { name: 'Create a passkey' }).click();
      const heading = page.getByRole('heading', { level: 1, name: 'Your membership card is ready' });
      await expect(heading).toBeVisible();
      // The button pressed has gone: the heading has the focus, so a screen reader says it.
      await expect(heading).toBeFocused();
      const { front, back } = sides(page);
      await expect(back).toBeVisible();
      await expect(front).toHaveCount(0);
      await expect(back).toContainText(name);
      await expect(back.locator('.mc-numk')).toHaveText(`Membership number ${grouped(person.membership.number)}`);
      // Written on: one animation a word, left to right, about 560 ms in all.
      const writing = await page.evaluate(() => window.__animated.filter((a) => a.cls.split(' ').includes('mc-hw')));
      if (motion === 'reduce') expect(writing).toEqual([]);
      else {
        expect(writing.length).toBe(name.split(/\s+/).length);
        const end = Math.max(...writing.map((w) => w.delay + w.duration));
        expect(end).toBeGreaterThanOrEqual(520);
        expect(end).toBeLessThanOrEqual(600);
        expect(writing.map((w) => w.delay)).toEqual([...writing.map((w) => w.delay)].sort((a, b) => a - b));
      }
      // The next steps are as they were.
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    });
  }

  // The card's fonts held back until `release` (or never), and every animation the page
  // starts recorded, with whether the pen's font had come by then.
  async function slowFonts(page, context) {
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    await context.route('**/fonts/*.ttf', async (route) => {
      await held;
      await route.continue();
    });
    await context.addInitScript(() => {
      const animate = Element.prototype.animate;
      window.__animated = [];
      Element.prototype.animate = function (keyframes, options) {
        if (String(this.className).split(' ').includes('mc-hw')) window.__animated.push({ at: performance.now(), pen: document.fonts.check('16px "Grape Nuts"') });
        return animate.call(this, keyframes, options);
      };
    });
    return () => release();
  }
  async function enrolNow(page, context, testInfo) {
    const name = unique('Slow', testInfo);
    const person = await admin.newPerson(name);
    const link = await admin.setupLink(person.id);
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(link);
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your membership card is ready' })).toBeVisible();
    return name;
  }
  const nameShown = (page) => page.locator('.mc-name .mc-v').evaluate((el) => getComputedStyle(el).visibility);

  test('the name waits, unseen, for its pen before it is written on', async ({ page, context }, testInfo) => {
    const release = await slowFonts(page, context);
    await enrolNow(page, context, testInfo);
    expect(await nameShown(page)).toBe('hidden');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__animated.length)).toBe(0);
    release();
    await expect.poll(() => page.evaluate(() => window.__animated.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__animated.every((a) => a.pen))).toBe(true);
    expect(await nameShown(page)).toBe('visible');
  });

  test('if the fonts are slow to come, the name is written on after a second or so anyway', async ({ page, context }, testInfo) => {
    const release = await slowFonts(page, context);
    try {
      await enrolNow(page, context, testInfo);
      const shownAt = await page.evaluate(() => performance.now());
      await expect.poll(() => page.evaluate(() => window.__animated.length), { timeout: 3000 }).toBeGreaterThan(0);
      const first = await page.evaluate(() => window.__animated[0]);
      expect(first.pen).toBe(false);
      expect(first.at - shownAt).toBeLessThan(1500);
      expect(await nameShown(page)).toBe('visible');
    } finally {
      release();
    }
  });

  test('a recovery link ends on the same card, as it was: nothing written on', async ({ page, context }, testInfo) => {
    const name = unique('Again', testInfo);
    const { person } = await signedInPerson(name);
    const { link } = await admin.post(`/api/admin/people/${person.id}/links`, { confirmedContact: true });
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Welcome back, ${name}` })).toBeVisible();
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    const heading = page.getByRole('heading', { level: 1, name: 'Your new passkey is ready' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText('Your membership card is the same as before.')).toBeVisible();
    const { back } = sides(page);
    await expect(back.locator('.mc-numk')).toHaveText(`Membership number ${grouped(person.membership.number)}`);
    expect(await nameShown(page)).toBe('visible');
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.classList?.contains('mc-hw')).length)).toBe(0);
  });
});
