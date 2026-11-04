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
