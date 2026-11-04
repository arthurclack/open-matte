// Runs the media scan's file checks off the main thread (see scanMedia).
import { parentPort, workerData } from 'node:worker_threads';
import { inspectMediaDir } from './scan.js';

// Tagged, because the result isn't the only message on this port: under
// node --watch (npm run dev), Node posts its own ({ 'watch:import': [...] }).
parentPort.postMessage({ scan: inspectMediaDir(workerData.mediaDir, workerData.previous) });
