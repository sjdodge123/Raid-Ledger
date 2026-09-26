#!/usr/bin/env npx tsx
/**
 * ApiClient — a truncated JSON body throws an error that names the method, the
 * path and the byte count, and is NEVER re-fetched: a truncation from the API
 * under test is a defect to surface, not to hide behind a retry on a green run,
 * and re-sending a mutation would apply it twice. A body stream that breaks
 * mid-read (undici "terminated") is named the same way.
 *
 * Background: discord-smoke run 36177266463 failed with a bare
 * `Unterminated string in JSON at position 139778` that named no request.
 *
 * Pure — global fetch is replaced by a stub; no network, no API, no env.
 *
 * Run: npx tsx src/smoke/api.spec.ts
 */
import assert from 'node:assert/strict';

import { ApiClient } from './api.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

const BASE = 'http://api.test';
/** Cut off mid-string; 13 characters but 14 UTF-8 bytes (é is two). */
const TRUNCATED = '{"name":"café';
const TRUNCATED_BYTES = 14;
const VALID = '{"name":"café"}';

/** `breakStream`: send `body`, then error the stream as undici does on a cut connection. */
type Canned = { status?: number; body: string; breakStream?: boolean };

function bodyOf(next: Canned): string | ReadableStream<Uint8Array> {
  if (!next.breakStream) return next.body;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(next.body));
      controller.error(new TypeError('terminated'));
    },
  });
}

/** Replace global fetch with a stub that serves `responses` in order. */
function stubFetch(responses: Canned[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(bodyOf(next), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

/** Settle `p` to its rejection; a resolution becomes an Error saying so. */
function rejectionOf(p: Promise<unknown>, what: string): Promise<unknown> {
  return p.then(
    () => new Error(`${what} resolved; expected it to throw`),
    (e: unknown) => e,
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const api = new ApiClient(BASE, 'test-token');
const realFetch = globalThis.fetch;

await test('get() returns a body that parses first time, with one fetch', async () => {
  const calls = stubFetch([{ body: VALID }]);
  const result = await api.get<{ name: string }>('/events/7');
  assert.deepEqual(result, { name: 'café' });
  assert.equal(calls.length, 1, `expected 1 fetch, got ${calls.length}`);
});

await test('get() throws naming the path and byte count on a truncated body, with no re-fetch', async () => {
  const calls = stubFetch([{ body: TRUNCATED }, { body: VALID }]);
  const err = await rejectionOf(api.get('/events?limit=5'), 'get()');
  assert.match(
    messageOf(err),
    new RegExp(`^GET /events\\?limit=5 → unparseable JSON \\(${TRUNCATED_BYTES} bytes\\): `),
  );
  assert.equal(calls.length, 1, `get() must not retry a truncated body: expected 1 fetch, got ${calls.length}`);
});

await test('get() names the path when the body stream breaks mid-read', async () => {
  const calls = stubFetch([{ body: TRUNCATED, breakStream: true }, { body: VALID }]);
  const err = await rejectionOf(api.get('/events/7'), 'get()');
  assert.equal(messageOf(err), 'GET /events/7 → body read failed: terminated');
  assert.equal(calls.length, 1, `expected 1 fetch, got ${calls.length}`);
});

await test('get() does not retry an HTTP error status', async () => {
  const calls = stubFetch([{ status: 500, body: TRUNCATED }, { body: VALID }]);
  const err = await rejectionOf(api.get('/events/7'), 'get()');
  assert.equal(messageOf(err), 'GET /events/7 → 500');
  assert.equal(calls.length, 1, `expected 1 fetch, got ${calls.length}`);
});

for (const method of ['post', 'put', 'patch'] as const) {
  await test(`${method}() names the path on a truncated body and never re-sends the mutation`, async () => {
    const calls = stubFetch([{ body: TRUNCATED }, { body: VALID }]);
    const err = await rejectionOf(api[method]('/events/7/signup', {}), `${method}()`);
    assert.equal(calls.length, 1, `${method}() must not retry: expected 1 fetch, got ${calls.length}`);
    assert.match(
      messageOf(err),
      new RegExp(`^${method.toUpperCase()} /events/7/signup → unparseable JSON \\(${TRUNCATED_BYTES} bytes\\): `),
    );
  });
}

globalThis.fetch = realFetch;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
