#!/usr/bin/env npx tsx
/**
 * ApiClient.get() — a truncated JSON body is re-fetched ONCE, and a second
 * truncated body throws an error that names the path and the byte counts.
 * Mutations (post/put/patch) are never retried: re-sending one after a
 * truncated response would apply it twice.
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

type Canned = { status?: number; body: string };

/** Replace global fetch with a stub that serves `responses` in order. */
function stubFetch(responses: Canned[]): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(next.body, {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

/** Capture console.warn for the duration of `fn`. */
async function captureWarn(fn: () => Promise<unknown>): Promise<string[]> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

const api = new ApiClient(BASE, 'test-token');
const realFetch = globalThis.fetch;

await test('get() returns a body that parses first time, with one fetch', async () => {
  const calls = stubFetch([{ body: VALID }]);
  const result = await api.get<{ name: string }>('/events/7');
  assert.deepEqual(result, { name: 'café' });
  assert.equal(calls.length, 1, `expected 1 fetch, got ${calls.length}`);
});

await test('get() re-fetches once after a truncated body and returns the second', async () => {
  const calls = stubFetch([{ body: TRUNCATED }, { body: VALID }]);
  let result: unknown;
  const warnings = await captureWarn(async () => {
    result = await api.get('/events?limit=5').catch((err: unknown) => err);
  });
  assert.equal(calls.length, 2, `expected one re-fetch after a truncated body, got ${calls.length} fetch(es)`);
  assert.deepEqual(calls, [`${BASE}/events?limit=5`, `${BASE}/events?limit=5`]);
  assert.deepEqual(result, { name: 'café' });
  assert.equal(warnings.length, 1, `expected 1 retry warning, got ${warnings.length}`);
  assert.match(warnings[0], /GET \/events\?limit=5 → unparseable JSON \(14 bytes\)/);
});

await test('get() throws naming the path and byte counts when both bodies are truncated', async () => {
  const calls = stubFetch([{ body: TRUNCATED }, { body: TRUNCATED }, { body: VALID }]);
  let err: unknown;
  await captureWarn(async () => {
    err = await api.get('/events?limit=5').then(
      () => new Error('get() resolved; expected it to throw'),
      (e: unknown) => e,
    );
  });
  const message = err instanceof Error ? err.message : String(err);
  assert.match(
    message,
    new RegExp(
      `^GET /events\\?limit=5 → unparseable JSON body twice \\(${TRUNCATED_BYTES} then ${TRUNCATED_BYTES} bytes\\): `,
    ),
  );
  assert.equal(calls.length, 2, `expected exactly one retry (2 fetches), got ${calls.length}`);
});

await test('get() does not retry an HTTP error status', async () => {
  const calls = stubFetch([{ status: 500, body: TRUNCATED }, { body: VALID }]);
  const err = await api.get('/events/7').then(
    () => new Error('get() resolved; expected it to throw'),
    (e: unknown) => e,
  );
  assert.equal(err instanceof Error ? err.message : String(err), 'GET /events/7 → 500');
  assert.equal(calls.length, 1, `expected 1 fetch, got ${calls.length}`);
});

for (const method of ['post', 'put', 'patch'] as const) {
  await test(`${method}() never re-sends a mutation after a truncated body`, async () => {
    const calls = stubFetch([{ body: TRUNCATED }, { body: VALID }]);
    const err = await api[method]('/events/7/signup', {}).then(
      () => new Error(`${method}() resolved; expected the truncated body to throw`),
      (e: unknown) => e,
    );
    assert.equal(calls.length, 1, `${method}() must not retry: expected 1 fetch, got ${calls.length}`);
    assert.ok(err instanceof SyntaxError, `expected a SyntaxError, got ${String(err)}`);
  });
}

globalThis.fetch = realFetch;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
