// Runs the media scan's file checks off the main thread (see scanMedia).
import { parentPort, workerData } from 'node:worker_threads';
import { inspectMediaDir } from './scan.js';

parentPort.postMessage(inspectMediaDir(workerData.mediaDir, workerData.previous));
