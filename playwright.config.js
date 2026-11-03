// Browser journeys (npm run e2e): a development tool only, never shipped.
// e2e/global-setup.js makes the test film, builds the web app if it's stale and
// starts the server on a free port; each journey in e2e/*.spec.js says which
// browsers it runs in and skips, with a reason, where one can't.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Firefox reads its profile list from ~/Library/Application Support/Firefox, which
// macOS protects as another app's data: launched from an app without that access
// it stops with "Could not find profile folder". Its own home under e2e/.cache
// keeps the test browser away from your real Firefox altogether.
const firefoxHome = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e', '.cache', 'firefox-home');
const firefoxEnv = () => {
  if (process.platform !== 'darwin') return {};
  fs.mkdirSync(firefoxHome, { recursive: true });
  return { launchOptions: { env: { ...process.env, HOME: firefoxHome, CFFIXED_USER_HOME: firefoxHome } } };
};

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.js',
  globalSetup: './e2e/global-setup.js',
  outputDir: 'test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Generous for media; everything else answers in well under a second.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // The server's address is only known once global setup has started it:
    // fixtures.js reads it from E2E_BASE_URL.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    // Playwright's own builds of the three engines.
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', ...firefoxEnv() } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    // The installed Google Chrome, which certainly decodes H.264 and AAC.
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
});
