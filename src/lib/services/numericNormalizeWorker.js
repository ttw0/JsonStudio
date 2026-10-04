import { createPersistentWorker } from './persistentWorker.js';
import { normalizeNumericJson } from './numericNormalize.js';

const worker = createPersistentWorker(
  () => new Worker(new URL('../workers/numericNormalize.worker.js', import.meta.url), { type: 'module' }),
);
let pending = Promise.resolve();

/** @param {string} content */
export async function normalizeNumericJsonAsync(content) {
  if (typeof Worker === 'undefined') return normalizeNumericJson(content);
  const result = pending.then(() => worker.run({ content }).promise);
  pending = result.then(() => undefined, () => undefined);
  return result;
}
