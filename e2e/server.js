// The server the browser journeys talk to: server/index.js's app, made with
// createApp as test/helpers.js does, so its rate limits can be raised (every
// journey signs in from the same address). Started by global-setup.js as a child
// process with DATA_DIR, MEDIA_DIR, WEB_DIST and the run's admin password in its
// environment; it says which port it got over IPC. No backups, no clean-up timer,
// no TMDB: nothing here reaches outside the machine.
import path from 'node:path';

const { assertConfig, config } = await import('../server/config.js');
const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

assertConfig();
const db = openDb(path.join(config.dataDir, 'open-matte.db'));
const app = createApp({ db, metadataOptions: { envKey: '' }, limits: { scale: 50 } });

// Every address, IPv4 and IPv6, so `localhost` works whichever it resolves to.
const server = app.listen(0, () => process.send?.({ port: server.address().port }));

const stop = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// The test runner went away without stopping us.
process.on('disconnect', stop);
