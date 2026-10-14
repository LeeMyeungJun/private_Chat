import { parentPort, workerData } from 'node:worker_threads';
import { fileTypeFromFile } from 'file-type';
import { parseFile } from 'music-metadata';
const types = { mp3: ['audio', 'audio/mpeg'], mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], m4a: ['audio', 'audio/mp4'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], opus: ['audio', 'audio/ogg'], flac: ['audio', 'audio/flac'], aac: ['audio', 'audio/aac'], webm: ['video', 'video/webm'] };
try {
  const detected = await fileTypeFromFile(workerData.filename);
  const type = types[detected?.ext];
  if (!type) parentPort.postMessage({});
  else {
    const metadata = await parseFile(workerData.filename, { duration: true, skipCovers: true });
    const duration = metadata.format.duration;
    const measured = Number.isFinite(duration) && duration > 0;
    parentPort.postMessage({ media: type[0], type: type[1], duration: measured ? duration : null, inlinePlayable: measured && duration <= workerData.maxDuration });
  }
} catch { parentPort.postMessage({}); }
