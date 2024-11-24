import { parentPort, workerData } from 'worker_threads';
import { RenderMap } from './map.js';

const result = await RenderMap(workerData);

if (parentPort) {
  parentPort.postMessage(result.path);
}
