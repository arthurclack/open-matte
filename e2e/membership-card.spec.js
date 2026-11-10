// The membership card (web/src/MembershipCard.jsx), in real browsers: on the account
// page, front up, with a Turn over button that works from the keyboard; the side
// facing down hidden from screen readers and out of reach; an instant swap for
// someone who asked for less motion; its fonts from this site; a barcode that reads
// back as the number. And on the page that makes a passkey, back up, with the name
// written on. Every journey here also fails on anything the Content-Security-Policy
// blocks (fixtures.js): the card draws its paper on canvases and its ink with SVG
// filters, and its fonts come from this site.
import zlib from 'node:zlib';
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

// ------------------------------------------------------------ pixels
// A screenshot's pixels (Playwright's PNGs: 8 bits, RGB or RGBA, not interlaced), and
// WCAG 2's contrast between two of them. Screenshots keep the caret as it is: hiding it
// takes a <style>, which the page's policy refuses. In WebKit, Playwright adds one to
// any screenshot (fixtures.js), so these are measured in the other browsers.
const NO_SHOTS_IN_WEBKIT = "Playwright's screenshots in WebKit add a <style> the page's policy refuses (fixtures.js)";
function pixels(png) {
  let at = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const data = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const kind = png.toString('latin1', at + 4, at + 8);
    if (kind === 'IHDR') [w, h, type] = [png.readUInt32BE(at + 8), png.readUInt32BE(at + 12), png[at + 17]];
    if (kind === 'IDAT') data.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { w, h, at: (x, y) => [0, 1, 2].map((i) => out[(y * w + x) * bpp + i]) };
}
const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const shot = async (page, clip) => pixels(await page.screenshot({ clip, caret: 'initial' }));
// Style set on elements for a moment, from script (the policy allows that), and put back.
async function restyled(page, rules, fn) {
  await page.evaluate((rules) => {
    window.__restyled = [];
    for (const [sel, style] of rules) {
      for (const el of document.querySelectorAll(sel)) {
        for (const [k, v] of Object.entries(style)) {
          window.__restyled.push([el, k, el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]);
          el.style.setProperty(k, v, 'important');
        }
      }
    }
  }, rules);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    return await fn();
  } finally {
    await page.evaluate(() => {
      for (const [el, k, v, p] of window.__restyled.reverse()) {
        if (v) el.style.setProperty(k, v, p);
        else el.style.removeProperty(k);
      }
    });
  }
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
  await expect(page.getByRole('heading', { level: 1, name: 'Your membership card' })).toBeVisible();
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
    // The card's three, besides the faces the page itself is set in (Libre Franklin,
    // IBM Plex Mono): every one from this site, and each fetched once.
    expect(fonts.filter((f) => /CourierPrime|Fraunces|GrapeNuts/.test(f)).sort()).toEqual(['/fonts/CourierPrime-Regular.ttf 200', '/fonts/Fraunces-Variable.ttf 200', '/fonts/GrapeNuts-Regular.ttf 200']);
    for (const f of fonts) expect(f).toMatch(/^\/fonts\/[A-Za-z0-9.-]+\.ttf 200$/);
    expect(new Set(fonts).size).toBe(fonts.length);
  });

  await test.step('and over again, back to the front', async () => {
    await page.keyboard.press('Space');
    await expect(front).toBeVisible();
    await expect(back).toHaveCount(0);
    await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
    await expect(page.locator('.mc [aria-live]')).toHaveText('The front of the card');
  });
});

test('the card turns over in 800 ms, and a second press mid-turn sends it back', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/account');
  const button = page.getByRole('button', { name: 'Turn over' });
  await expect(sides(page).front).toBeVisible();
  const transition = await page.locator('.mc-face--front').evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`;
  });
  expect(transition).toBe('transform 0.8s cubic-bezier(0.3, 0.1, 0.2, 1)');
  await button.click();
  await expect(page.locator('.mc')).toHaveClass(/is-turning/);
  // Both sides are drawn while it turns.
  expect((await faces(page)).map((f) => f.visibility)).toEqual(['visible', 'visible']);
  await button.click();
  await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
  await expect(sides(page).front).toBeVisible();
  await expect(sides(page).back).toHaveCount(0);
});

// Every transition the card is running, paused where it has got to: the faces, their
// shades and the strips of its cut edge.
const frozen = (page, at) =>
  page.evaluate((t) => {
    const root = document.querySelector('.mc');
    const anims = document.getAnimations().filter((a) => root.contains(a.effect?.target));
    for (const a of anims) {
      a.pause();
      if (t !== undefined) a.currentTime = t;
    }
    return anims.map((a) => ({
      cls: String(a.effect.target.className),
      prop: a.transitionProperty,
      time: Math.round(a.currentTime),
      duration: Math.round(a.effect.getComputedTiming().duration),
      progress: Math.round(a.effect.getComputedTiming().progress * 1000) / 1000,
    }));
  }, at);

test('turning over, the card shows its thickness: a cut edge, turning with its faces, back the same way on a second press', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/account');
  await expect(sides(page).front).toBeVisible();
  const edges = page.locator('.mc-edge');

  await test.step('lying still: no edge to see, and the face up drawn flat', async () => {
    expect(await edges.count()).toBe(14);
    expect(await edges.evaluateAll((els) => els.every((el) => getComputedStyle(el).visibility === 'hidden'))).toBe(true);
    expect(await page.locator('.mc-face--front').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });

  await test.step('mid-turn: two faces a card’s thickness apart, and its edge between them', async () => {
    // The card's own settle timer would end the turn under a paused frame.
    await page.evaluate(() => {
      const st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => (ms === 1050 ? 0 : st(fn, ms, ...a));
    });
    await page.getByRole('button', { name: 'Turn over' }).click();
    const running = await frozen(page, 237);
    // Both faces, both shades and the fourteen strips, all on the same 800 ms.
    expect(running.length).toBe(18);
    expect(new Set(running.map((a) => `${a.duration} ${a.time} ${a.progress}`)).size).toBe(1);
    const width = (await page.locator('.mc-stage').boundingBox()).width;
    const thickness = await page.locator('.mc').evaluate((el) => parseFloat(el.style.getPropertyValue('--mc-t')));
    expect(thickness).toBeCloseTo(width * 0.013, 1);
    expect(thickness).toBeLessThanOrEqual(6);
    expect(await page.locator('.mc-face--front').evaluate((el) => getComputedStyle(el).transformOrigin.split(' ')[2])).toBe(`${-thickness / 2}px`);
    // Edge-on, the faces are all but gone: the edge, facing the eye, is the card.
    const strip = await edges.first().boundingBox();
    expect(strip.width).toBeGreaterThan(thickness * 0.8);
    expect(strip.height).toBeGreaterThan((width * 54) / 85.6 - 30);
    expect(await edges.first().evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
  });

  await test.step('a second press sends every part back by the same path', async () => {
    await page.evaluate(() => {
      for (const a of document.getAnimations()) a.play();
    });
    await page.getByRole('button', { name: 'Turn over' }).click();
    const back = await frozen(page);
    expect(back.length).toBe(18);
    expect(new Set(back.map((a) => `${a.duration} ${a.progress}`)).size).toBe(1);
    // Shortened alike: back from where it got to, not a whole turn's time.
    expect(back[0].duration).toBeLessThan(800);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) a.play();
    });
    await expect(page.locator('.mc')).not.toHaveClass(/is-turning/);
    await expect(sides(page).front).toBeVisible();
    expect(await edges.evaluateAll((els) => els.every((el) => getComputedStyle(el).visibility === 'hidden'))).toBe(true);
  });
});

test('Member since is stamped with the counter’s date stamp, and read in full', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn over' }).click();
  const { back } = sides(page);
  const stamp = back.locator('.mc-since .mc-stamp');
  await expect(stamp).toHaveAttribute('aria-hidden', 'true');
  const look = await stamp.evaluate((el) => ({
    caps: getComputedStyle(el).textTransform,
    ink: getComputedStyle(el).color,
    tilt: Number(el.style.getPropertyValue('--mc-tilt').replace('deg', '')),
    bands: el.querySelectorAll('.mc-sc').length,
    // Its own layer, blended into the card: its wear can only lighten its own ink.
    blend: getComputedStyle(el).mixBlendMode,
  }));
  expect(look).toMatchObject({ caps: 'uppercase', ink: 'rgb(70, 32, 106)', bands: 8, blend: 'multiply' });
  expect(Math.abs(look.tilt)).toBeGreaterThanOrEqual(1);
  expect(Math.abs(look.tilt)).toBeLessThanOrEqual(2.4);
  // Read once, in full, after its printed label.
  const now = new Date();
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(now);
  expect(await back.locator('.mc-since').evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim())).toMatch(/^Member since/);
  await expect(back.locator('.mc-since .visually-hidden')).toHaveText(month);
});

test('the stamp never touches the print: the label above it and the rule below are the same with its wear and without the stamp at all', async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', NO_SHOTS_IN_WEBKIT);
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn over' }).click();
  const field = sides(page).back.locator('.mc-since');
  await expect.poll(() => field.locator('.mc-stamp-wear').evaluate((c) => c.width)).toBeGreaterThan(0);
  await page.evaluate(() => document.fonts.ready);
  // At the far ends of where it's put, and where this member's went.
  for (const at of [null, [2.4, -1, 3], [-2.4, -1, -1], [2.4, 1, 3], [-2.4, 1, -1]]) {
    if (at) {
      await field.locator('.mc-stamp').evaluate((el, [t, y, x]) => {
        el.style.setProperty('--mc-tilt', `${t}deg`);
        el.style.setProperty('--mc-sy', `${y}px`);
        el.style.setProperty('--mc-sx', `${x}px`);
      }, at);
    }
    const box = await field.boundingBox();
    const clip = { x: Math.floor(box.x) - 2, y: Math.floor(box.y) - 2, width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 6 };
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const worn = await shot(page, clip);
    const unworn = await restyled(page, [['.mc-face--back .mc-stamp-wear', { visibility: 'hidden' }]], () => shot(page, clip));
    const print = await restyled(page, [['.mc-face--back .mc-stamp', { visibility: 'hidden' }]], () => shot(page, clip));
    // The print's own pixels: the label and the rule, dark without the stamp.
    let n = 0;
    let most = 0;
    for (let y = 0; y < print.h; y++) {
      for (let x = 0; x < print.w; x++) {
        if (lum(print.at(x, y)) > 0.35) continue;
        n++;
        most = Math.max(most, Math.abs(lum(worn.at(x, y)) - lum(unworn.at(x, y))));
      }
    }
    expect(n, 'the label and the rule are there').toBeGreaterThan(200);
    // A hair of the screen's own rounding at most; the stamp's wear once lifted them by a third.
    expect(most, `the print, with the stamp at ${at ?? 'its own place'}`).toBeLessThan(0.02);
  }
});

test('every month is stamped clear: in each, no two of its characters touch', async ({ page, context }, testInfo) => {
  await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let month = 0;
  await page.route('**/api/account', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.membership.since = Date.UTC(2031, month, 15);
    await route.fulfill({ response: res, json });
  });
  for (month = 0; month < 12; month++) {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Turn over' }).click();
    await page.evaluate(() => document.fonts.ready);
    // Each character's ink, as the stamp's face draws it (not every browser measures a
    // glyph's ink, so it's drawn and looked at), condensed as its band has it.
    const bands = await sides(page)
      .back.locator('.mc-stamp-ink')
      .evaluate((ink) => {
        const cs = getComputedStyle(ink);
        const size = parseFloat(cs.fontSize);
        const c = document.createElement('canvas');
        c.width = Math.ceil(size * 3);
        c.height = Math.ceil(size * 2);
        const g = c.getContext('2d', { willReadFrequently: true });
        const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return [...ink.querySelectorAll('.mc-sc:not(.mc-sc--sp)')].map((b) => {
          g.clearRect(0, 0, c.width, c.height);
          g.font = font;
          g.fillText(b.textContent.toUpperCase(), size, size * 1.4);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let [x0, x1] = [c.width, -1];
          for (let i = 3; i < d.length; i += 4) {
            if (d[i] < 64) continue;
            const x = ((i - 3) / 4) % c.width;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
          }
          const squeeze = Number(getComputedStyle(b).getPropertyValue('--sq'));
          return { ch: b.textContent, ink: (x1 - x0 + 1) * squeeze, band: b.offsetWidth, face: document.fonts.check(font) };
        });
      });
    expect(bands.length).toBe(7);
    for (const b of bands) {
      expect(b.face, `${b.ch} in the stamp's own face`).toBe(true);
      // At least a pixel of bare card between one character and the next, edges and all.
      expect(b.ink, `${b.ch} in ${month + 1}/2031: ${b.ink.toFixed(1)}px of ink in a ${b.band}px band`).toBeLessThanOrEqual(b.band - 1);
    }
  }
});

test.describe('read where they are lightest', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine measures it; the others draw the same ink (the e2e journeys above check they draw it)');

  test('the stamp, the pen and the printed labels read at 4.5:1 or more on the darkest of the card behind them', async ({ newContext }, testInfo) => {
    // At four device pixels to a CSS pixel, a pen's stroke has a core to measure.
    const context = await newContext({ deviceScaleFactor: 4, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    // A short name, where a pen's skips would show most.
    const { cookie } = await signedInPerson(`Jo Li ${Math.random().toString(36).slice(2, 4)}`);
    await context.addCookies([cookie]);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Turn over' }).click();
    await page.evaluate(() => document.fonts.ready);
    const back = '.mc-face--back';
    await expect(page.locator(`${back} .mc-hw.is-penned`).first()).toBeAttached();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    const targets = {
      stamp: [`${back} .mc-since .mc-stamp`, `${back} .mc-since .mc-stamp-ink, ${back} .mc-since .mc-sc`],
      pen: [`${back} .mc-name .mc-hw:first-child`, `${back} .mc-name .mc-hw`],
      label: [`${back} .mc-since .mc-k`, `${back} .mc-since .mc-k`],
    };
    for (const [what, [boxOf, marks]] of Object.entries(targets)) {
      const box = await page.locator(boxOf).boundingBox();
      const clip = { x: Math.floor(box.x) - 6, y: Math.floor(box.y) - 6, width: Math.ceil(box.width) + 12, height: Math.ceil(box.height) + 12 };
      const drawn = await shot(page, clip);
      const paper = await restyled(page, [[`${back} .mc-ink *, ${back} .mc-bar`, { visibility: 'hidden' }]], () => shot(page, clip));
      // The marks alone, solid black on white, for where their letters' cores are.
      const mask = await restyled(
        page,
        [
          [`${back} .mc-sheet > :not(.mc-ink), ${back} .mc-ink *, ${back} canvas`, { visibility: 'hidden' }],
          [`${back} .mc-sheet`, { 'background-color': '#fff' }],
          [`${back} .mc-ink, ${back} .mc-stamp`, { 'mix-blend-mode': 'normal' }],
          [marks, { visibility: 'visible', color: '#000', filter: 'none', 'text-shadow': 'none' }],
        ],
        () => shot(page, clip),
      );
      const er = 1;
      const dark = (x, y) => lum(mask.at(x, y)) < 0.06;
      const cores = [];
      const behind = [];
      for (let y = er; y < mask.h - er; y++) {
        for (let x = er; x < mask.w - er; x++) {
          behind.push(paper.at(x, y));
          if ([[0, 0], [er, 0], [-er, 0], [0, er], [0, -er], [er, er], [-er, -er], [er, -er], [-er, er]].every(([dx, dy]) => dark(x + dx, y + dy))) cores.push(drawn.at(x, y));
        }
      }
      behind.sort((a, b) => lum(a) - lum(b));
      const third = behind.slice(0, Math.floor(behind.length / 3));
      const darkest = [0, 1, 2].map((i) => third.reduce((s, c) => s + c[i], 0) / third.length);
      cores.sort((a, b) => lum(b) - lum(a));
      expect(cores.length, `${what}: its letters' cores`).toBeGreaterThan(40);
      const lightest = cores[Math.floor(cores.length * 0.05)];
      expect(ratio(lightest, darkest), `${what}, its lightest twentieth`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test('in WebKit on a 2x screen, the back’s printed words are set larger and scaled down, so their bleed is drawn at the screen’s pixels, each where it was', async ({ newContext, browserName }) => {
  test.skip(browserName !== 'webkit', 'only WebKit draws SVG filters at one pixel to a CSS pixel');
  const context = await newContext({ deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const { cookie } = await signedInPerson(`Big Print ${Math.random().toString(36).slice(2, 6)}`);
  await context.addCookies([cookie]);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn over' }).click();
  await page.evaluate(() => document.fonts.ready);
  const lines = ['.mc-name .mc-k', '.mc-since .mc-k', '.mc-numk', '.mc-small', '.mc-name .mc-v', '.mc-stamp'];
  const where = () =>
    page.evaluate((lines) => lines.map((s) => {
      const el = document.querySelector(`.mc-face--back ${s}`);
      const r = el.getBoundingClientRect();
      return { s, big: el.classList.contains('mc-big'), filter: getComputedStyle(el).filter, box: [r.left, r.top, r.width, r.height] };
    }), lines);
  await expect.poll(async () => (await where()).filter((l) => l.big).length).toBe(4);
  const big = await where();
  for (const l of big.slice(0, 4)) expect(l.filter, l.s).toMatch(/url\(.*-kblz/);
  // As another engine has them: each line within a pixel of where it was.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.mc-big')) {
      el.classList.remove('mc-big');
      for (const p of ['font-size', 'width', 'margin-top', 'margin-right', 'margin-bottom', 'transform-origin']) el.style.removeProperty(p);
    }
  });
  const plain = await where();
  big.forEach((l, i) => {
    const [x, y, w, h] = l.box;
    const [x0, y0, w0, h0] = plain[i].box;
    expect(Math.max(Math.abs(x - x0), Math.abs(y - y0), Math.abs(h - h0)), l.s).toBeLessThan(1);
    expect(Math.abs(w - w0), l.s).toBeLessThan(2);
  });
});

test('the name is written in ballpoint over its own letters, which stay the text that is read', async ({ page, context }, testInfo) => {
  const { name } = await signedIn(context, testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Turn over' }).click();
  const { back } = sides(page);
  const words = back.locator('.mc-name .mc-hw');
  await expect(words.first()).toHaveClass(/is-penned/);
  const pen = await words.evaluateAll((els) =>
    els.map((el) => {
      const c = el.querySelector('canvas.mc-pen');
      return { penned: el.classList.contains('is-penned'), drawn: c.width > 0 && c.height > 0, hidden: c.getAttribute('aria-hidden'), color: getComputedStyle(el).color };
    }),
  );
  expect(pen.length).toBe(name.split(/\s+/).length);
  for (const w of pen) expect(w).toEqual({ penned: true, drawn: true, hidden: 'true', color: 'rgba(0, 0, 0, 0)' });
  // Read, and selected, as the name it is.
  await expect(back.locator('.mc-name .mc-v')).toHaveText(name);
  await expect(back).toContainText(name);
});

for (const [what, media] of [
  ['more contrast asked for', { contrast: 'more' }],
  ['forced colours', { forcedColors: 'active' }],
]) {
  test(`with ${what}, the card is plain ink: no soaking in, no wear, no bleed`, async ({ page, context }, testInfo) => {
    await signedIn(context, testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce', ...media });
    await page.goto('/account');
    await page.getByRole('button', { name: 'Turn over' }).click();
    const plain = await page.locator('.mc').evaluate((root) => {
      const back = root.querySelector('.mc-card--back > .mc-sheet');
      const cs = (sel) => getComputedStyle(back.querySelector(sel));
      return {
        blend: getComputedStyle(back.querySelector(':scope > .mc-ink')).mixBlendMode,
        wear: ['.mc-inkwear', '.mc-pen', '.mc-stamp-wear'].map((s) => cs(s).display),
        filters: ['.mc-name .mc-k', '.mc-name .mc-v', '.mc-stamp-ink', '.mc-small'].map((s) => cs(s).filter),
        // The name in its own letters again, not left clear over a pen that isn't drawn.
        name: cs('.mc-name .mc-hw').color,
      };
    });
    expect(plain).toMatchObject({ blend: 'normal', wear: ['none', 'none', 'none'], filters: ['none', 'none', 'none', 'none'] });
    expect(plain.name).not.toBe('rgba(0, 0, 0, 0)');
  });
}

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

test('the card prints in the shop’s colour, made dark enough to read on it; Open Matte’s own prints blue', async ({ page, context, browserName }, testInfo) => {
  await signedIn(context, testInfo);
  // The shop's ink, and as it is laid down on the card's ink layer: a touch lighter, so
  // that soaked into the cream stock (blended "multiply") it shows as the shop's ink,
  // deepened a little by the cream. And what shows: the band, as drawn, about that.
  const ink = async () => ({
    shop: await page.locator('.mc').evaluate((el) => el.style.getPropertyValue('--mc-ink')),
    band: await page.locator('.mc-band-ink').evaluate((el) => getComputedStyle(el).backgroundColor),
    name: await page.locator('.mc-shop').evaluate((el) => getComputedStyle(el).color),
  });
  const shows = async () => {
    if (browserName === 'webkit') return null;
    const box = await page.locator('.mc-band').boundingBox();
    const band = await shot(page, { x: Math.round(box.x + box.width * 0.6), y: Math.round(box.y + box.height * 0.25), width: Math.round(box.width * 0.3), height: Math.round(box.height * 0.5) });
    const all = [];
    for (let y = 0; y < band.h; y++) for (let x = 0; x < band.w; x++) all.push(band.at(x, y));
    return [0, 1, 2].map((i) => all.map((c) => c[i]).sort((a, b) => a - b)[all.length >> 1]);
  };
  const near = (got, want, by) => !got || got.every((c, i) => Math.abs(c - want[i]) <= by);
  // The cinema's colours are shared by every browser: one journey at a time changes them.
  await exclusively('colours', async () => {
    try {
      await admin.patch('/api/admin/settings', { accentColor: '#e8b04a' });
      await page.goto('/account');
      await expect(sides(page).front).toBeVisible();
      expect(await ink()).toEqual({ shop: '#2030c8', band: 'rgb(33, 51, 225)', name: 'rgb(33, 51, 225)' });
      // Soaked in, #1f2db2 on the plain stock; on the card's own tone and wear, about that.
      const blue = await shows();
      expect(near(blue, [31, 45, 178], 18), `the band shows as rgb(${blue})`).toBe(true);
      // A pale yellow accent prints darkened to a mustard, keeping its hue.
      await admin.patch('/api/admin/settings', { accentColor: '#f2e8a0' });
      await page.reload();
      await expect(sides(page).front).toBeVisible();
      expect(await ink()).toEqual({ shop: '#4e4603', band: 'rgb(82, 75, 3)', name: 'rgb(82, 75, 3)' });
      const mustard = await shows();
      expect(near(mustard, [75, 65, 3], 18), `the band shows as rgb(${mustard})`).toBe(true);
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
