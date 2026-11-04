// Packages are installed without running their install scripts (.npmrc, and both
// of the Dockerfile's npm ci), so that a compromised release can't run its code
// just by being installed. That is only safe while no package needs its script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const file = (name) => new URL(`../${name}`, import.meta.url);
const read = (name) => fs.readFileSync(file(name), 'utf8');
const here = (name) => fs.existsSync(file(name));

test('the only package with an install script works without it', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const withScripts = Object.entries(lock.packages).filter(([, p]) => p.hasInstallScript).map(([name]) => name);
  // fsevents (file watching on a Mac, for Vite) ships its compiled part; its script
  // would only build it again. A new name here needs checking before it's added.
  assert.deepEqual(withScripts, ['node_modules/fsevents']);
});

test('install scripts are turned off on this computer and in the image', { skip: !(here('.npmrc') && here('Dockerfile')) && '.npmrc and the Dockerfile are not here (the server image has neither)' }, () => {
  assert.match(read('.npmrc'), /^ignore-scripts=true$/m);
  const installs = read('Dockerfile').match(/npm ci[^\n&]*/g);
  assert.equal(installs.length, 2, 'the build and the runtime stage');
  for (const line of installs) assert.match(line, /--ignore-scripts/, line);
});

// The running image only ever runs node: no package manager is left in it to
// fetch and run code (the base image brings yarn and corepack as well as npm).
test('the running image has no package manager', { skip: !here('Dockerfile') && 'no Dockerfile here (the server image has none)' }, () => {
  // The runtime stage, with each instruction's continued lines joined up.
  const runtime = read('Dockerfile').split(/^FROM /m).at(-1).replace(/\\\n/g, ' ');
  const removed = (runtime.match(/rm -rf ([^\n]*)/) ?? [, ''])[1].split(/\s+/).filter(Boolean);
  for (const p of ['/usr/local/lib/node_modules/npm', '/usr/local/bin/npm', '/usr/local/bin/npx', '/usr/local/lib/node_modules/corepack', '/usr/local/bin/corepack', '/opt/yarn-v*', '/usr/local/bin/yarn', '/usr/local/bin/yarnpkg']) {
    assert.ok(removed.includes(p), `the runtime stage removes ${p}`);
  }
});
