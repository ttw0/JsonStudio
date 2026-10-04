import { normalizeNumericJson } from '../services/numericNormalize.js';

self.onmessage = event => {
  const { id, payload } = event.data;
  try {
    self.postMessage({ id, ok: true, result: normalizeNumericJson(payload.content) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' });
  }
};
