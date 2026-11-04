// server/index.js as the image runs it: what it writes is for its own user alone.
// The database holds ticket links anyone could use, and people's names, so no
// other account on the server may read it or its backups.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADMIN_PASSWORD, adminBrowser, tempDir } from './helpers.js';

const INDEX = fileURLToPath(new URL('../server/index.js', import.meta.url));

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

const mode = (file) => (fs.statSync(file).mode & 0o777).toString(8);

test('the database, its journal and its backups can be read by the server’s own user only', { skip: process.platform === 'win32' && 'no Unix file modes' }, async () => {
  const dataDir = tempDir();
  const backupDir = path.join(tempDir(), 'backups'); // made by the first backup
  const port = await freePort();
  const child = spawn(process.execPath, [INDEX], {
    env: {
      PATH: process.env.PATH,
      ADMIN_PASSWORD,
      PORT: String(port),
      DATA_DIR: dataDir,
      MEDIA_DIR: tempDir(),
      BACKUP_DIR: backupDir,
      WEB_DIST: path.join(dataDir, 'no-web-build'),
      COOKIE_SECURE: 'false',
      TMDB_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      const seen = (chunk) => {
        output += chunk;
        if (output.includes('Open Matte listening')) resolve();
      };
      child.stdout.on('data', seen);
      child.stderr.on('data', seen);
      exited.then(() => reject(new Error(`the server stopped:\n${output}`)));
    });
    const admin = await adminBrowser(`http://127.0.0.1:${port}`);
    const made = await admin.post('/api/admin/backups');
    assert.equal(made.status, 201, JSON.stringify(made.data));

    const db = path.join(dataDir, 'open-matte.db');
    const journal = ['-wal', '-shm'].map((s) => db + s).filter((f) => fs.existsSync(f));
    assert.ok(journal.length, 'the database is open in WAL mode');
    for (const file of [db, ...journal, path.join(backupDir, made.data.backup.name)]) assert.equal(mode(file), '600', path.basename(file));
    assert.equal(mode(backupDir), '700', 'the backups folder');
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
