// Device labels: enough for the admin to tell devices apart.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { deviceLabel } = await import('../server/sessions.js');

test('device labels name the browser and device, including browsers on iPhone', () => {
  const cases = {
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1': 'Safari on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15': 'Firefox on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/140.0 Version/18.0 Mobile/15E148 Safari/604.1': 'Edge on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1': 'Chrome on iPhone',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15': 'Safari on Mac',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0': 'Edge on Windows',
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 EdgA/141.0': 'Edge on Android',
    'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0': 'Firefox on Linux',
  };
  for (const [ua, label] of Object.entries(cases)) assert.equal(deviceLabel(ua), label, ua);
});
