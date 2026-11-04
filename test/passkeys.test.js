// The browser half of passkeys (web/src/passkeys.js): which browsers are sent to
// Safari or Chrome before trying, which refusals offer that afterwards, and the words
// people see when the browser or the cinema says no. These are plain functions; the
// ceremonies themselves run in e2e/passkeys.spec.js, with Chromium's virtual
// authenticator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, test } from 'node:test';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../web/src/passkeys.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const { anotherBrowserMayHelp, browserProblem, serverProblem, supportsPasskeys } = present ? await import(MODULE) : {};

// A browser, near enough: a window with or without the passkey API, and a user agent.
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function browser(userAgent, { webauthn = true } = {}) {
  globalThis.window = webauthn ? { PublicKeyCredential: function PublicKeyCredential() {} } : {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true, writable: true });
}
after(() => {
  delete globalThis.window;
  Object.defineProperty(globalThis, 'navigator', realNavigator);
});

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  // Apps' own browsers.
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.39.105]',
  wechat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x18003637) NetType/WIFI Language/en',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36',
};

describe('which browsers are sent to Safari or Chrome before trying', { skip }, () => {
  test('real browsers get the passkey button', () => {
    for (const name of ['macSafari', 'macChrome', 'windowsEdge', 'firefox', 'iphoneSafari', 'androidChrome']) {
      browser(UA[name]);
      assert.equal(supportsPasskeys(), true, name);
    }
  });

  test("apps' built-in browsers get Copy link, WeChat's and Android's plain web view among them", () => {
    for (const name of ['instagram', 'facebook', 'wechat', 'androidWebView']) {
      browser(UA[name]);
      assert.equal(supportsPasskeys(), false, name);
    }
  });

  test('a browser without the passkey API gets Copy link', () => {
    browser(UA.macChrome, { webauthn: false });
    assert.equal(supportsPasskeys(), false);
  });
});

describe('after the browser says no', { skip }, () => {
  const named = (name, code) => Object.assign(new Error(name), { name, code });

  test('a refusal or failure offers another browser: an unlisted app browser looks just like it', () => {
    for (const err of [named('NotAllowedError'), named('NotSupportedError'), named('InvalidStateError'), named('UnknownError'), new Error('odd')]) {
      assert.equal(anotherBrowserMayHelp(err), true, err.name);
    }
  });

  test('not an attempt a newer one replaced, nor an address no browser could use', () => {
    assert.equal(anotherBrowserMayHelp(named('AbortError')), false);
    assert.equal(anotherBrowserMayHelp(named('Error', 'ERROR_CEREMONY_ABORTED')), false);
    assert.equal(anotherBrowserMayHelp(named('SecurityError', 'ERROR_INVALID_RP_ID')), false);
  });

  test('what people are told', (t) => {
    t.mock.method(console, 'error', () => {});
    assert.equal(browserProblem(named('AbortError')), null);
    assert.equal(browserProblem(named('NotAllowedError')), 'Cancelled or timed out. Try again.');
    assert.equal(browserProblem(named('SecurityError')), "This address can't use passkeys.");
    assert.match(browserProblem(named('UnknownError'), { creating: true }), /couldn't create a passkey/);
    assert.match(browserProblem(named('UnknownError')), /couldn't use a passkey/);
  });
});

describe('after the cinema says no', { skip }, () => {
  const refused = (code, status = 400) => ({ code, status });

  test('each refusal has its own words, and names whoever runs the cinema where they can help', () => {
    assert.equal(serverProblem(refused('ceremony-expired')), 'That took a little too long. Try again.');
    assert.equal(serverProblem(refused('sign-in-failed'), 'Harbour Lights'), "That passkey didn't work. Try again, or ask whoever runs Harbour Lights.");
    assert.equal(serverProblem(refused('passkey-invalid')), "Your passkey couldn't be checked. Try again.");
    assert.equal(serverProblem(refused('account-disabled')), 'This account has been turned off. Ask whoever runs this cinema.');
    assert.match(serverProblem(refused('too-many-requests', 429)), /^Too many attempts/);
  });

  test("an unreachable cinema isn't blamed on the person", () => {
    assert.match(serverProblem(new Error('Failed to fetch')), /^Couldn't reach the cinema/);
    assert.match(serverProblem(refused(undefined, 502)), /^Couldn't reach the cinema/);
    assert.equal(serverProblem(refused('something-new', 400)), 'Something went wrong. Try again.');
  });
});
