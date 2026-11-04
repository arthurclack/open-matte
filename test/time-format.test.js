// How the web app writes times (web/src/api.js). A 12-hour clock has no leading zero
// ("8:59 AM"), a 24-hour one keeps it ("08:59"), and the space before AM or PM can't
// break. The formatters take the browser's own locale when the module loads, so each
// locale runs in a Node of its own, with LC_ALL set. Firefox, which writes the hour
// its own way, is covered by e2e/shell.spec.js.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, test } from 'node:test';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../web/src/api.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';

const MORNING = Date.UTC(2026, 10, 16, 8, 59);
const EVENING = Date.UTC(2026, 10, 16, 21, 0);

// Every formatter's answer for the two times, in UTC, as a browser in `posix` would write them.
function formatted(posix) {
  const code = `
    const m = await import(${JSON.stringify(MODULE.href)});
    const out = { locale: new Intl.DateTimeFormat().resolvedOptions().locale };
    for (const [name, ms] of [['morning', ${MORNING}], ['evening', ${EVENING}]]) {
      out[name] = { time: m.formatTime(ms), dateTime: m.formatDateTime(ms), dateTimeYear: m.formatDateTimeYear(ms), dayTime: m.formatDayTime(ms) };
    }
    process.stdout.write(JSON.stringify(out));`;
  const env = { ...process.env, LC_ALL: `${posix}.UTF-8`, LANG: `${posix}.UTF-8`, TZ: 'UTC' };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' }));
}

// A Node built without every locale falls back to another, which would test nothing.
function inLocale(t, posix) {
  const out = formatted(posix);
  const wanted = posix.replace('_', '-');
  if (out.locale !== wanted) {
    t.skip(`this Node has no ${wanted} (it gave ${out.locale})`);
    return null;
  }
  return out;
}

describe('times', { skip }, () => {
  test('on a 24-hour clock keep their leading zero, in every formatter', (t) => {
    const out = inLocale(t, 'en_GB');
    if (!out) return;
    assert.deepEqual(out.morning, { time: '08:59', dateTime: '16 Nov, 08:59', dateTimeYear: '16 Nov 2026, 08:59', dayTime: 'Mon 16 Nov, 08:59' });
    assert.deepEqual(out.evening, { time: '21:00', dateTime: '16 Nov, 21:00', dateTimeYear: '16 Nov 2026, 21:00', dayTime: 'Mon 16 Nov, 21:00' });
  });

  test('on a 12-hour clock have no leading zero, and never break before AM or PM', (t) => {
    const out = inLocale(t, 'en_US');
    if (!out) return;
    // A no-break space, or the narrow one some versions of ICU write themselves.
    const nb = '[\u00a0\u202f]';
    for (const [name, clock] of [['morning', `8:59${nb}AM`], ['evening', `9:00${nb}PM`]]) {
      for (const [formatter, text] of Object.entries(out[name])) {
        assert.match(text, new RegExp(`(^|, )${clock}$`), `${formatter}, ${name}: ${JSON.stringify(text)}`);
        assert.doesNotMatch(text, /0\d:/, `${formatter}, ${name}`);
      }
    }
  });

  test('keep a 12-hour clock whose AM or PM comes first, as in Korean, on one line', (t) => {
    const out = inLocale(t, 'ko_KR');
    if (!out) return;
    for (const [formatter, text] of Object.entries(out.morning)) {
      assert.match(text, /오전[\u00a0\u202f]8:59$/, `${formatter}: ${JSON.stringify(text)}`);
    }
  });

  test('keep the leading zero in Japanese, whose clock is 24-hour', (t) => {
    const out = inLocale(t, 'ja_JP');
    if (!out) return;
    assert.equal(out.morning.time, '08:59');
    for (const text of Object.values(out.morning)) assert.match(text, /(^|\D)08:59$/, JSON.stringify(text));
  });
});
