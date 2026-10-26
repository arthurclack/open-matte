import path from 'node:path';
import { createApp } from './app.js';
import { assertConfig, config } from './config.js';
import { openDb } from './db.js';
import { scanMedia } from './scan.js';

assertConfig();
const db = openDb(path.join(config.dataDir, 'open-matte.db'));

const app = createApp({ db });
// Daily database backups, and one shortly after start if the last is over a day old.
app.locals.backups.start();
const server = app.listen(config.port, () => {
  console.log(`Open Matte listening on :${config.port} (media: ${config.mediaDir}, data: ${config.dataDir})`);
});

// Pick up anything copied into the media folder while the server was down.
// The site is already serving while this runs, from what the last scan found.
scanMedia(db, config.mediaDir)
  .then((report) => {
    if (report.unavailable) return console.warn(`Media scan: ${report.unavailable}`);
    const count = (status) => report.films.filter((f) => f.status === status).length;
    console.log(
      `Media scan: ${report.films.length} film folder(s) (${count('ok')} ok, ${count('warning')} with warnings, ${count('error')} with errors), ` +
        `${report.removed.length} missing, ${report.skipped.length} skipped`,
    );
    // Look up any films that haven't been matched against TMDb yet.
    app.locals.metadata.queueUnmatched();
  })
  .catch((err) => console.error('Media scan failed:', err));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
