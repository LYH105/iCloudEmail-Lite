import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout, UpstreamTimeoutError } from '../src/icloud/http.js';

test('Apple/iCloud requests fail with a bounded, actionable timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        { once: true },
      );
    })) as typeof fetch;

  try {
    await assert.rejects(fetchWithTimeout('https://example.test', {}, 5), (err: unknown) => {
      assert.ok(err instanceof UpstreamTimeoutError);
      assert.equal(err.status, 504);
      assert.match(err.message, /超时/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
