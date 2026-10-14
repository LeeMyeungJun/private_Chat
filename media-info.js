import { Worker } from 'node:worker_threads';
export const MAX_INLINE_MEDIA_SECONDS = 10 * 60;
export function inspectMedia(filename) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./media-worker.js', import.meta.url), { workerData: { filename, maxDuration: MAX_INLINE_MEDIA_SECONDS }, resourceLimits: { maxOldGenerationSizeMb: 96 } });
    let completed = false;
    function finish(value = {}) { if (completed) return; completed = true; clearTimeout(timeout); worker.terminate(); resolve(value); }
    const timeout = setTimeout(() => finish(), 8000);
    worker.once('message', finish);
    worker.once('error', () => finish());
    worker.once('exit', () => finish());
  });
}
