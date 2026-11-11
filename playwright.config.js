// Browser journeys (npm run e2e): a development tool only, never shipped.
// e2e/global-setup.js makes the test films (a copy of each for every project below),
// builds the web app if it's stale and starts the server on a free port; each journey
// in e2e/*.spec.js says which browsers it runs in and skips, with a reason, where one
// can't.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Firefox reads its profile list from ~/Library/Application Support/Firefox, which
// macOS protects as another app's data: launched from an app without that access
// it stops with "Could not find profile folder". A home of its own keeps the test
// browser away from your real Firefox altogether. It lives in the system's temp
// folder, not the repo: macOS gives the Library and Downloads folders it makes there
// a home folder's "deny delete" ACL, which rm -rf, git clean and git worktree remove
// can't get past.
const firefoxHome = path.join(os.tmpdir(), 'open-matte-e2e-firefox-home');
const firefoxEnv = () => {
  if (process.platform !== 'darwin') return {};
  fs.mkdirSync(firefoxHome, { recursive: true });
  return { launchOptions: { env: { ...process.env, HOME: firefoxHome, CFFIXED_USER_HOME: firefoxHome } } };
};

// Where Playwright looks for the installed Google Chrome (channel: 'chrome'). Without
// it, the chrome project's journeys skip with this reason rather than fail to launch.
function chromeMissing() {
  const places = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/opt/google/chrome/chrome'],
    win32: [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
      .filter(Boolean)
      .map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  }[process.platform];
  if (places?.some((p) => fs.existsSync(p))) return undefined;
  return 'Google Chrome isn\'t installed where Playwright looks for it, so the chrome project has nothing to run in';
}

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
  // A project's name goes into its films' folder names (e2e/film.js): lowercase
  // letters, digits and hyphens only.
  projects: [
    // Playwright's own builds of the three engines.
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', ...firefoxEnv() } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    // The installed Google Chrome, which certainly decodes H.264 and AAC.
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' }, metadata: { missing: chromeMissing() } },
  ],
});
