// scripts/deploy.sh, run against a stand-in server: a folder on this computer,
// reached through an `ssh` that runs its commands here, with a `docker` that only
// notes what it was asked. What arrives is the code and nothing private (no
// database or backup, wherever it sits), and Caddy is told to load the Caddyfile
// that was sent, from a folder it sees the new file through.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEPLOY_SH = path.join(ROOT, 'scripts', 'deploy.sh');
const DEPLOY_DIR = path.join(ROOT, 'deploy');

let skip = false;
if (process.platform === 'win32') skip = 'deploy.sh needs a Unix shell';
else if (!fs.existsSync(DEPLOY_SH) || !fs.existsSync(path.join(DEPLOY_DIR, 'compose.yml'))) skip = 'scripts/ and deploy/ are not here (the server image has neither)';
else if (spawnSync('rsync', ['--version']).error || spawnSync('bash', ['--version']).error) skip = 'needs rsync and bash';

const write = (file, content = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();

// The caddy service's mount of its config, read from compose.yml.
function caddyConfigMount(compose) {
  const service = compose.split(/^ {2}caddy:\s*$/m)[1].split(/^\S/m)[0];
  const volumes = service.split(/^ {4}volumes:\s*$/m)[1].split(/^ {4}\S/m)[0];
  const mounts = [...volumes.matchAll(/^\s+- ([^:\s]+):([^:\s]+)(?::ro)?\s*$/gm)].map((m) => ({ source: m[1], target: m[2] }));
  return mounts.find((m) => m.target.startsWith('/etc/caddy'));
}

// A copy of the code with private files in it, a stand-in server, and the deploy.
// `reloadFails` is how many times Caddy refuses to reload before it accepts.
async function deploy({ reloadFails = 0 } = {}) {
  const repo = tempDir();
  write(path.join(repo, 'scripts', 'deploy.sh'), fs.readFileSync(DEPLOY_SH));
  fs.cpSync(DEPLOY_DIR, path.join(repo, 'deploy'), { recursive: true, filter: (f) => path.basename(f) !== '.env' });
  for (const f of ['server/index.js', 'server/data/defaults.js', 'web/src/media/icons.js', 'web/src/site.jsx']) write(path.join(repo, f), 'code');
  write(path.join(repo, 'site', 'index.html'), 'the project website');
  const secret = [
    'data/open-matte.db',
    'media/arrival/film.json',
    'dist/index.html',
    'node_modules/express/index.js',
    'open-matte-2026-11-03-153012.db', // a backup downloaded to make before an update
    'backups/open-matte-2026-11-03-040012.db',
    'web/open-matte.db-wal',
    '.env',
    'deploy/.env',
  ];
  for (const f of secret) write(path.join(repo, f), 'private');

  const server = tempDir();
  const app = path.join(server, 'app');
  write(path.join(app, 'deploy', '.env'), "the server's settings");
  write(path.join(app, 'removed-since.txt'));

  const bin = tempDir();
  // Runs what it's given here, as the server would.
  write(path.join(bin, 'ssh'), '#!/bin/sh\nshift\nexec sh -c "$*"\n');
  write(
    path.join(bin, 'docker'),
    [
      '#!/bin/sh',
      'echo "$(pwd -P)|$*" >> "$DOCKER_LOG"',
      'case "$*" in *"caddy reload"*)',
      '  n=$(($(cat "$DOCKER_LOG.reloads" 2>/dev/null || echo 0) + 1)); echo $n > "$DOCKER_LOG.reloads"',
      '  if [ "$n" -le "$RELOAD_FAILS" ]; then echo "Error: Caddy refused the config" >&2; exit 1; fi;;',
      'esac',
      '',
    ].join('\n'),
  );
  for (const f of ['ssh', 'docker']) fs.chmodSync(path.join(bin, f), 0o755);

  const log = path.join(bin, 'docker.log');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RSYNC_RSH: path.join(bin, 'ssh'), DOCKER_LOG: log, RELOAD_FAILS: String(reloadFails) };
  const code = await new Promise((resolve) => {
    execFile('bash', [path.join(repo, 'scripts', 'deploy.sh'), 'my-server', server], { env }, (err) => resolve(err ? err.code : 0));
  });
  const docker = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split('|'))
    : [];
  return { code, repo, app, docker, secret };
}

describe('scripts/deploy.sh', { skip, concurrency: true }, () => {
  test('sends the code and none of the private files, wherever they sit, and keeps the server’s settings', async () => {
    const { code, app } = await deploy();
    assert.equal(code, 0);
    const sent = filesUnder(app);
    for (const f of ['server/index.js', 'server/data/defaults.js', 'web/src/media/icons.js', 'deploy/compose.yml', 'scripts/deploy.sh']) {
      assert.ok(sent.includes(f), `${f} is sent`);
    }
    assert.deepEqual(sent.filter((f) => /\.db(-|$)|(^|\/)\.env$|^(data|media|dist|node_modules|backups)\//.test(f)), ['deploy/.env']);
    assert.equal(fs.readFileSync(path.join(app, 'deploy', '.env'), 'utf8'), "the server's settings");
    assert.ok(!sent.includes('removed-since.txt'), 'the server’s copy matches this one');
  });

  test('leaves out the project website, which a cinema never uses', async () => {
    const { code, app } = await deploy();
    assert.equal(code, 0);
    const sent = filesUnder(app);
    assert.deepEqual(sent.filter((f) => f.startsWith('site/')), []);
    assert.ok(sent.includes('web/src/site.jsx'), 'the app’s own site.jsx is still sent');
  });

  test('starts the new code and has Caddy load the new Caddyfile, from a folder it sees the new file through', async () => {
    const { code, app, docker } = await deploy();
    assert.equal(code, 0);
    const deployDir = fs.realpathSync(path.join(app, 'deploy'));
    assert.deepEqual(docker, [
      [deployDir, 'compose up -d --build'],
      [deployDir, 'compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'],
      [deployDir, 'compose ps'],
    ]);
    // An update replaces the Caddyfile with a new file. A container that mounts
    // the file itself goes on seeing the old one; one that mounts its folder sees
    // the new one, so the reload reads what was sent.
    const mount = caddyConfigMount(fs.readFileSync(path.join(app, 'deploy', 'compose.yml'), 'utf8'));
    assert.ok(mount, 'compose.yml mounts Caddy’s config');
    assert.ok(fs.statSync(path.join(deployDir, mount.source)).isDirectory(), `${mount.source} is a folder, not the Caddyfile itself`);
    const config = '/etc/caddy/Caddyfile';
    assert.ok(config.startsWith(`${mount.target}/`), 'the reload reads from the mounted folder');
    const sent = path.join(deployDir, mount.source, path.relative(mount.target, config));
    assert.equal(fs.readFileSync(sent, 'utf8'), fs.readFileSync(path.join(DEPLOY_DIR, mount.source, 'Caddyfile'), 'utf8'));
  });

  test('a Caddyfile that Caddy refuses fails the deploy', async () => {
    const { code, docker } = await deploy({ reloadFails: 99 });
    assert.notEqual(code, 0);
    assert.deepEqual(
      docker.map(([, cmd]) => cmd.split(' ').slice(0, 3).join(' ')),
      ['compose up -d', 'compose exec -T', 'compose exec -T', 'compose exec -T'],
      'tried three times, and never got as far as compose ps',
    );
  });

  test('a Caddy just started, not answering yet, is asked again', async () => {
    const { code, docker } = await deploy({ reloadFails: 1 });
    assert.equal(code, 0);
    assert.equal(docker.filter(([, cmd]) => cmd.includes('caddy reload')).length, 2);
    assert.equal(docker.at(-1)[1], 'compose ps');
  });
});
