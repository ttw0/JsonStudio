import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumericJson } from '../src/lib/services/numericNormalize.js';
import { normalizeNumericJsonAsync } from '../src/lib/services/numericNormalizeWorker.js';
import { parseBigInt } from '../src/lib/utils/jsonBigInt.js';

test('numeric normalization queues concurrent requests and recovers after a failure', async () => {
  const previousWorker = globalThis.Worker;
  let active = 0;
  let peak = 0;
  let instances = 0;
  globalThis.Worker = class {
    constructor() { instances += 1; }
    postMessage({ id, payload }) {
      peak = Math.max(peak, ++active);
      setTimeout(() => {
        active -= 1;
        try {
          this.onmessage({ data: { id, ok: true, result: normalizeNumericJson(payload.content) } });
        } catch (error) {
          this.onmessage({ data: { id, ok: false, error: error.message } });
        }
      }, 1);
    }
    terminate() {}
  };
  try {
    const requests = [
      normalizeNumericJsonAsync('{id:9007199254740993}'),
      normalizeNumericJsonAsync('{invalid'),
      normalizeNumericJsonAsync('{id:18446744073709551615}'),
    ];
    const results = await Promise.allSettled(requests);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(parseBigInt(results[0].value).id, 9007199254740993n);
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(parseBigInt(results[2].value).id, 18446744073709551615n);
    assert.equal(peak, 1);
    assert.equal(instances, 1);
  } finally {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  }
});
