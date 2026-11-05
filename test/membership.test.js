// The membership card: its number (server/membership.js), its barcode and its ink
// (web/src/membershipCard.js), and who is sent the number. The card's design is in
// the VHS mock-ups (card/notes.md: "The membership number"): SHA-256 of the 32 bytes
// behind people.webauthn_user_id, the first 8 bytes as a number, its last 10 digits,
// then a Luhn check digit; printed 4-4-3 and as a Codabar, start A, stop B, 2.5:1.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { luhnDigit, luhnValid, membershipNumber } from '../server/membership.js';
import { DEFAULT_ACCENT, contrast, mix } from '../server/theme.js';
import { softAuthenticator } from './softauth.js';
import { adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } from './helpers.js';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: the barcode and ink tests are skipped there.
const MODULE = new URL('../web/src/membershipCard.js', import.meta.url);
const web = fs.existsSync(MODULE) ? await import(MODULE) : null;
const noWeb = web ? false : 'web/src is not here (the server image has no web source)';

// The mock-up's sample member (vhs/analogue/kit.js, Kit.SAMPLE.member.webauthnUserId),
// whose card the review sheets show as 5040 1811 463.
const SAMPLE_ID = 'zFcylIXAhVQHjRtj4IhxM8mo0XKAV97xBmdDxdEREBc';
const randomId = () => crypto.randomBytes(32).toString('base64url');

describe('the membership number', () => {
  test("is the mock-up's for the mock-up's member", () => {
    assert.equal(membershipNumber(SAMPLE_ID), '50401811463');
  });

  test('is 11 digits that pass the Luhn check, the same every time for the same id', () => {
    for (let i = 0; i < 200; i++) {
      const id = randomId();
      const n = membershipNumber(id);
      assert.match(n, /^\d{11}$/, id);
      assert.ok(luhnValid(n), `${n} passes the Luhn check`);
      assert.equal(membershipNumber(id), n, 'the same id, the same number');
    }
  });

  test('is worked out from the id’s bytes, not its text, and differs between people', () => {
    const bytes = Buffer.from(SAMPLE_ID, 'base64url');
    const hash = crypto.createHash('sha256').update(bytes).digest();
    const ten = (hash.readBigUInt64BE(0) % 10n ** 10n).toString().padStart(10, '0');
    assert.equal(membershipNumber(SAMPLE_ID), ten + luhnDigit(ten));
    const many = new Set(Array.from({ length: 500 }, () => membershipNumber(randomId())));
    assert.equal(many.size, 500, 'no two of 500 alike');
  });

  test('keeps its leading zeros', () => {
    // The SHA-256 of "zero 13" as an id, whose number starts with two zeros: worked out
    // apart from the app, in Python's hashlib, from the same recipe.
    const id = crypto.createHash('sha256').update('zero 13').digest().toString('base64url');
    assert.equal(id, 'puNDUJPG4c-QFzUVHZayoqDI8Dc5KWfaUsRJlblsro0');
    assert.equal(membershipNumber(id), '00723125241');
    assert.ok(luhnValid('00723125241'));
    // And a few more like it, found by counting: about one id in ten. Capped, so a
    // number that lost its zeros fails here rather than never finishing.
    const zeros = [];
    for (let i = 0; i < 200 && zeros.length < 5; i++) {
      const n = membershipNumber(crypto.createHash('sha256').update(`zero ${i}`).digest().toString('base64url'));
      if (n.startsWith('0')) zeros.push(n);
    }
    assert.equal(zeros.length, 5, 'numbers that start with a zero');
    for (const n of zeros) assert.match(n, /^0\d{10}$/);
  });

  test('the Luhn check catches any one wrong digit and a swap of two different neighbours', () => {
    const n = membershipNumber(SAMPLE_ID);
    for (let i = 0; i < n.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === n[i]) continue;
        assert.equal(luhnValid(n.slice(0, i) + d + n.slice(i + 1)), false, `digit ${i} as ${d}`);
      }
    }
    for (let i = 0; i + 1 < n.length; i++) {
      if (n[i] === n[i + 1] || `${n[i]}${n[i + 1]}` === '09' || `${n[i]}${n[i + 1]}` === '90') continue;
      assert.equal(luhnValid(n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2)), false, `swap at ${i}`);
    }
    // Known check digits.
    assert.equal(luhnDigit('7992739871'), '3');
    assert.equal(luhnDigit('0000000000'), '0');
  });
});

// ------------------------------------------------------------ the barcode

// Codabar from its specification, written out separately from the app's table: each
// character's 7 elements (bar, space, bar, space, bar, space, bar), 1 for wide.
const SPEC = {
  0: '0000011', 1: '0000110', 2: '0001001', 3: '1100000', 4: '0010010', 5: '1000010', 6: '0100001', 7: '0100100', 8: '0110000', 9: '1001000',
  '-': '0001100', $: '0011000', ':': '1000101', '/': '1010001', '.': '1010100', '+': '0010101', A: '0011010', B: '0101001', C: '0001011', D: '0001110',
};
const BY_PATTERN = Object.fromEntries(Object.entries(SPEC).map(([ch, p]) => [p, ch]));
// The narrow and wide bars fitCodabar picks, in device pixels.
const pick = (text, available, dpr) => {
  const fit = web.fitCodabar(text, available, dpr);
  return [fit.n, fit.w];
};

// Reads bars [[x, width]] back as a scanner would: the bars and the spaces between them
// as one row of widths, split at the threshold between narrow and wide, 7 elements to
// a character with one gap between characters, which must be narrow.
function decode(bars) {
  const runs = [];
  bars.forEach(([x, w], i) => {
    if (i) runs.push(x - (bars[i - 1][0] + bars[i - 1][1]));
    runs.push(w);
  });
  assert.ok(runs.every((r) => r > 0), 'no bars touch or overlap');
  const narrow = Math.min(...runs);
  const wide = Math.max(...runs);
  const cut = (narrow + wide) / 2;
  let out = '';
  for (let k = 0; k < runs.length; k += 8) {
    const pattern = runs.slice(k, k + 7).map((r) => (r > cut ? '1' : '0')).join('');
    assert.ok(BY_PATTERN[pattern], `character ${k / 8}: ${pattern} is no Codabar character`);
    if (k + 7 < runs.length) assert.ok(runs[k + 7] < cut, `the gap after character ${k / 8} is narrow`);
    out += BY_PATTERN[pattern];
  }
  return { text: out, narrow, wide };
}

describe('the barcode', { skip: noWeb }, () => {
  test('a Codabar of the number, start A, stop B, reads back, in every whole-pixel size', () => {
    for (const id of [SAMPLE_ID, randomId(), randomId()]) {
      const n = membershipNumber(id);
      const text = web.codabarText(n);
      assert.equal(text, `A${n}B`);
      for (const [narrow, wide] of [[1, 2], [1, 3], [2, 5], [3, 8], [4, 10]]) {
        const { bars } = web.codabarPx(text, narrow, wide);
        const read = decode(bars);
        assert.equal(read.text, text, `${narrow}:${wide}`);
        assert.equal(read.narrow, narrow);
        assert.equal(read.wide, wide);
        assert.ok(bars.every(([x, w]) => Number.isInteger(x) && Number.isInteger(w)), 'whole pixels');
      }
    }
  });

  test('fitted to a label: whole device pixels, wide to narrow 2:1 to 3:1, inside the label, and it reads back', () => {
    const text = web.codabarText(membershipNumber(SAMPLE_ID));
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const available of [133, 135, 142.4, 147, 151.5, 152.4, 187.6, 200, 240, 400]) {
        const fit = web.fitCodabar(text, available, dpr);
        assert.ok(fit, `${available}px at ${dpr}x`);
        assert.ok(fit.width <= Math.floor(available * dpr), 'inside the label');
        assert.ok(fit.w / fit.n >= 2 && fit.w / fit.n <= 3, `${fit.w}:${fit.n}`);
        assert.equal(decode(fit.bars).text, text);
        assert.ok(fit.bars.every(([x, w]) => Number.isInteger(x) && Number.isInteger(w)));
        assert.ok(fit.bars[0][0] >= fit.n, 'a narrow blank before the first bar');
      }
    }
    // Too narrow for even 1-pixel bars.
    assert.equal(web.fitCodabar(text, 60, 1), null);
  });

  // The room the barcode really has, inside the label's 3px sides: the label is 46% of
  // the card, never under 153px (membershipCard.css). Cards 288px wide (a 320 phone),
  // 343 and 358 (375 and 390), 360, and 440 (768 and wider).
  const ROOM = { 288: 147, 343: 151.8, 358: 158.7, 360: 159.6, 440: 196.4 };
  test('on every card, on a 1.5x, 2x or 3x screen, and at 1x and 1.25x on a wide one, wide bars are at least 2.25 narrow ones', () => {
    const text = web.codabarText(membershipNumber(SAMPLE_ID));
    const css = fs.readFileSync(new URL('../web/src/membershipCard.css', import.meta.url), 'utf8');
    assert.match(css, /\.mc-bar \{[^}]*width: max\(46%, 153px\)/, 'the label is 46% of the card, never under 153px');
    assert.match(css, /\.mc-label-ink \{ padding: 6px 3px 4px;/, 'inside 3px sides');
    for (const [card, available] of Object.entries(ROOM)) {
      assert.equal(available, Math.round((Math.max(0.46 * card, 153) - 6) * 10) / 10, `${card}px card`);
      for (const dpr of card >= 440 ? [1, 1.25, 1.5, 1.75, 2, 3] : [1.5, 2, 3]) {
        const fit = web.fitCodabar(text, available, dpr);
        assert.ok(fit.w / fit.n >= 2.25, `${card}px card at ${dpr}x: ${fit.w}:${fit.n}`);
        assert.equal(decode(fit.bars).text, text);
      }
    }
    // At 2x: 2-pixel narrow bars and 5-pixel wide ones, 2.5:1. At 3x, 3 and 8 (2.67:1),
    // or on the smallest card 3 and 7 (2.33:1), the nearest that fits. At 1x on the wide
    // card, 1 and 3; at 1.5x, 2 and 5.
    assert.deepEqual(pick(text, ROOM[358], 2), [2, 5]);
    assert.deepEqual(pick(text, ROOM[288], 2), [2, 5]);
    assert.deepEqual(pick(text, ROOM[358], 3), [3, 8]);
    assert.deepEqual(pick(text, ROOM[288], 3), [3, 7]);
    assert.deepEqual(pick(text, ROOM[440], 1), [1, 3]);
    assert.deepEqual(pick(text, ROOM[440], 1.5), [2, 5]);
  });

  test('2.5:1 rather than 3:1 when both fit, and never thinner bars for a wider ratio', () => {
    const text = web.codabarText(membershipNumber(SAMPLE_ID));
    // Room for 3:1 at 2x (322 device pixels): still 2.5:1, as the card asks.
    assert.deepEqual(pick(text, 170, 2), [2, 5]);
    // The old label's room at 2x (142.4px): 2:1 in 2-pixel bars, not 3:1 in 1-pixel ones.
    assert.deepEqual(pick(text, 142.4, 2), [2, 4]);
    // At 1x on a 360px card (a window under 768px wide): 3:1 needs 161px; 2:1 fits.
    assert.deepEqual(pick(text, ROOM[360], 1), [1, 2]);
  });

  test('only digits between the start and the stop', () => {
    assert.throws(() => web.codabarPx('A12B34B', 1, 2));
    assert.throws(() => web.codabarPx('A12xB', 1, 2));
  });

  test('the number is grouped 4, 4 and 3', () => {
    assert.equal(web.groupNumber('50401811463'), '5040 1811 463');
    assert.equal(web.groupNumber('01162841041'), '0116 2841 041');
  });
});

// ------------------------------------------------------------ the shop's name, letter by letter

describe("the shop's name in rub-down letters", { skip: noWeb }, () => {
  const letters = (text) => web.rubDown(text, 'shop').map((word) => word.map((l) => l.ch));

  test('Latin, Greek, Cyrillic, Chinese and Japanese are set a letter at a time, each as a reader sees it', () => {
    assert.deepEqual(letters('The Lantern Room'), [['T', 'h', 'e'], ['L', 'a', 'n', 't', 'e', 'r', 'n'], ['R', 'o', 'o', 'm']]);
    assert.deepEqual(letters('Кино'), [['К', 'и', 'н', 'о']]);
    assert.deepEqual(letters('映画館'), [['映', '画', '館']]);
    // An accent typed as its own character stays with its letter; so does a flag, and
    // a family of four in one emoji.
    assert.deepEqual(letters('Cine\u0301'), [['C', 'i', 'n', 'e\u0301']]);
    assert.deepEqual(letters('Video 🇬🇧'), [['V', 'i', 'd', 'e', 'o'], ['🇬🇧']]);
    assert.deepEqual(letters('👨‍👩‍👧‍👦 Films'), [['👨‍👩‍👧‍👦'], ['F', 'i', 'l', 'm', 's']]);
  });

  test('where letters join or run right to left, a word at a time', () => {
    assert.deepEqual(letters('سينما الحي'), [['سينما'], ['الحي']]);
    assert.deepEqual(letters('קולנוע'), [['קולנוע']]);
    assert.deepEqual(letters('सिनेमा घर'), [['सिनेमा'], ['घर']]);
    assert.deepEqual(letters('โรงหนัง'), [['โรงหนัง']]);
    // One such word in the name, and all of it is set a word at a time.
    assert.deepEqual(letters('Cinema سينما'), [['Cinema'], ['سينما']]);
    assert.equal(web.lettersStandAlone('The Lantern Room'), true);
    assert.equal(web.lettersStandAlone('Room\u200f'), false, 'a right-to-left mark');
  });

  test('the same name, the same letters, card after card', () => {
    assert.deepEqual(web.rubDown('The Lantern Room', 'shop:x'), web.rubDown('The Lantern Room', 'shop:x'));
  });
});

// ------------------------------------------------------------ the ink

describe('the ink', { skip: noWeb }, () => {
  const stock = web?.CARD_STOCK;
  // The card at its darkest grain, as the ink rule judges it.
  const shaded = web && mix(stock, '#000000', 0.1);

  test("a shop on Open Matte's own accent prints in the blue screen's blue, and so does one with none", () => {
    assert.equal(web.DEFAULT_ACCENT, DEFAULT_ACCENT, "server/theme.js's default");
    for (const accent of [DEFAULT_ACCENT, DEFAULT_ACCENT.toUpperCase(), undefined, null, '', 'blue', '#fff']) {
      assert.equal(web.printInk(accent).ink, '#2030c8', String(accent));
    }
    assert.ok(contrast('#2030c8', stock) >= 4.5);
  });

  test('every accent prints readable on the card, and the card knocked out of its band reads too', () => {
    const accents = ['#f2e8a0', '#F2E8A0', '#34905b', '#e5776d', '#7fc28b', '#8ab4f8', '#ffffff', '#ff00ff', '#5a1e1e', '#0b3d2e', '#1a1a6e', '#000000'];
    for (const accent of accents) {
      const { ink } = web.printInk(accent);
      assert.match(ink, /^#[0-9a-f]{6}$/);
      assert.ok(contrast(ink, stock) >= 4.5, `${accent} prints ${ink}: ${contrast(ink, stock).toFixed(2)}:1 on the card`);
      assert.ok(contrast(shaded, ink) >= 4.5, `${accent}: even where the card's grain is darkest`);
      // "Membership card", bare card knocked out of the band, where the band's ink lies
      // thinnest (88%: its wear, MembershipCard.jsx, leaves at least 92%).
      assert.ok(contrast(stock, mix(stock, ink, 0.88)) >= 4.5, `${accent}: the words on a band of ${ink} at 88%`);
      assert.ok(contrast(shaded, mix(shaded, ink, 0.88)) >= 4.5, `${accent}: and on its darkest grain`);
    }
  });

  test('a pale accent is darkened keeping its hue, as the mock-up shows; a dark one prints as it is', () => {
    // card/notes.md, the data map: #F2E8A0 prints #4E4603, #34905B prints #03532D.
    assert.equal(web.printInk('#F2E8A0').ink, '#4e4603');
    assert.equal(web.printInk('#34905b').ink, '#03532d');
    // Already dark enough on the card: unchanged.
    assert.equal(web.printInk('#0b3d2e').ink, '#0b3d2e');
    assert.equal(web.printInk('#5a1e1e').ink, '#5a1e1e');
  });
});

// ------------------------------------------------------------ who is sent it

describe('who is sent the membership number', () => {
  const mediaDir = tempDir();
  let srv;
  let admin;
  let slug;
  before(async () => {
    makeFilm(mediaDir, 'arrival');
    srv = await startServer({ mediaDir, limits: { scale: 100 } });
    admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const film = (await admin.get('/api/admin/films')).data[0];
    slug = film.slug;
    await admin.patch(`/api/admin/films/${film.id}`, { published: true });
  });
  after(() => srv.close());

  let counter = 0;
  async function member(name) {
    const p = await newPerson(admin, `${name} ${++counter}`);
    const phone = browser(srv.base);
    const auth = softAuthenticator();
    const r = await enroll(phone, (await setupLink(admin, p.id)).token, { auth });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, phone, auth, finish: r.data, userId: r.options.user.id };
  }

  test('the person themselves: on the page that makes their passkey, and in their account', async () => {
    const sam = await member('Sam');
    const number = membershipNumber(sam.userId);
    const createdAt = (await admin.get(`/api/admin/people/${sam.p.id}`)).data.createdAt;
    assert.deepEqual(sam.finish.membership, { number, since: createdAt }, 'with the passkey just made');
    const account = await sam.phone.get('/api/account');
    assert.equal(account.status, 200);
    assert.deepEqual(account.data.membership, { number, since: createdAt });
    // In another browser, signed in with the same passkey: the same card.
    const laptop = browser(srv.base);
    assert.equal((await signIn(laptop, sam.auth)).status, 200);
    assert.deepEqual((await laptop.get('/api/account')).data.membership, { number, since: createdAt });
  });

  test('the admin, on the person’s page: the same number, never their id', async () => {
    const sam = await member('Sam');
    const detail = (await admin.get(`/api/admin/people/${sam.p.id}`)).data;
    assert.deepEqual(detail.membership, { number: membershipNumber(sam.userId), since: detail.createdAt });
    assert.notEqual(detail.membership.number, String(detail.id));
    assert.doesNotMatch(detail.membership.number, new RegExp(`^0*${detail.id}$`));
    // A person not set up yet has a card too: the number is theirs from the start.
    const waiting = await newPerson(admin, `Waiting ${++counter}`);
    assert.match(waiting.membership.number, /^\d{11}$/);
    assert.equal(waiting.membership.since, waiting.createdAt);
  });

  test('a name change, a new passkey and a reset keep the same card', async () => {
    const sam = await member('Sam');
    const before = (await admin.get(`/api/admin/people/${sam.p.id}`)).data.membership;
    await admin.patch(`/api/admin/people/${sam.p.id}`, { name: `Samuel ${++counter}` });
    const recovery = await setupLink(admin, sam.p.id, { reset: true, confirmedContact: true });
    const phone = browser(srv.base);
    const r = await enroll(phone, recovery.token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.membership, before);
    assert.deepEqual((await phone.get('/api/account')).data.membership, before);
  });

  test('nobody else: not before sign-in, not another member, not in any other answer', async () => {
    const sam = await member('Sam');
    const alex = await member('Alex');
    const samNumber = sam.finish.membership.number;
    // The account needs a signed-in person.
    const stranger = browser(srv.base);
    const r = await stranger.get('/api/account');
    assert.equal(r.status, 401);
    assert.equal(r.data.membership, undefined);
    // Another member sees only their own card.
    const theirs = await alex.phone.get('/api/account');
    assert.equal(theirs.data.membership.number, alex.finish.membership.number);
    assert.notEqual(theirs.data.membership.number, samNumber);
    assert.ok(!JSON.stringify(theirs.data).includes(samNumber));
    // Nothing else a browser can ask for carries it, signed in or not.
    const link = await setupLink(admin, (await newPerson(admin, `Link ${++counter}`)).id);
    const opened = await stranger.post('/api/enroll/options', { token: link.token });
    assert.equal(opened.status, 200);
    assert.equal(opened.data.membership, undefined, 'opening a setup link: not until the passkey is made');
    for (const b of [stranger, sam.phone]) {
      for (const url of ['/api/me', '/api/site', `/api/films/${slug}`]) {
        const res = await b.get(url);
        assert.ok(!JSON.stringify(res.data ?? '').includes(samNumber), `${url}`);
        assert.equal(res.data?.membership, undefined, url);
      }
    }
    // A sign-in says who you are, not your number.
    const again = await signIn(browser(srv.base), sam.auth);
    assert.equal(again.status, 200);
    assert.ok(!JSON.stringify(again.data).includes(samNumber));
  });
});
