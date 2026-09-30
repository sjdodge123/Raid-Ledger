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
 * A 401 on a client made by `ApiClient.login()` (the JWT expired mid-suite)
 * re-logs in ONCE and re-sends ONCE. A bare-JWT client never re-logs in, a
 * failed re-login surfaces the original 401, and nothing ever loops.
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

/** One stubbed fetch: the URL and the Authorization header it carried. */
type Call = { url: string; auth: string | null };

/** Replace global fetch with a stub that serves `responses` in order. */
function stubFetch(responses: Canned[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
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

/** A login response minting `token`. */
function loginOk(token: string): Canned {
  return { body: JSON.stringify({ access_token: token, user: { id: 9 } }) };
}

/** A client made by login() (so it may re-login), with its own fetch stub. */
async function loginClient(): Promise<ApiClient> {
  stubFetch([loginOk('token-1')]);
  return ApiClient.login(BASE, 'admin@test', 'pw');
}

const UNAUTHORIZED: Canned = { status: 401, body: '{"message":"Unauthorized"}' };

await test('a login client re-logs in once on a 401 and returns the re-sent body', async () => {
  const client = await loginClient();
  const calls = stubFetch([UNAUTHORIZED, loginOk('token-2'), { body: VALID }]);
  const result = await client.get<{ name: string }>('/events/7').catch((e: unknown) => e);
  assert.deepEqual(result, { name: 'café' }, `expected the re-sent body, got ${messageOf(result)}`);
  assert.deepEqual(
    calls.map((c) => c.url),
    [`${BASE}/events/7`, `${BASE}/auth/local`, `${BASE}/events/7`],
    'expected call → re-login → re-send',
  );
  assert.equal(calls[2].auth, 'Bearer token-2', 'the re-send must carry the fresh token');
});

await test('a failed re-login throws the original 401 with the re-login failure as cause', async () => {
  const client = await loginClient();
  const calls = stubFetch([UNAUTHORIZED, { status: 500, body: '{}' }, { body: VALID }]);
  const err = await rejectionOf(client.get('/events/7'), 'get()');
  assert.equal(calls.length, 2, `expected 2 fetches (call + re-login), got ${calls.length}`);
  assert.equal(messageOf(err), 'GET /events/7 → 401');
  const cause = err instanceof Error ? err.cause : undefined;
  assert.equal(messageOf(cause), 'Login failed: 500', 'the re-login failure must be the cause');
});

await test('a bare-token client throws on a 401 without re-logging in', async () => {
  const calls = stubFetch([UNAUTHORIZED, loginOk('token-2'), { body: VALID }]);
  const err = await rejectionOf(api.get('/events/7'), 'get()');
  assert.equal(messageOf(err), 'GET /events/7 → 401');
  assert.equal(calls.length, 1, `a bare-token client must not re-login: expected 1 fetch, got ${calls.length}`);
});

await test('401 → re-login → 401 throws the normal error after exactly 3 fetches', async () => {
  const client = await loginClient();
  const calls = stubFetch([UNAUTHORIZED, loginOk('token-2'), UNAUTHORIZED, loginOk('token-3'), { body: VALID }]);
  const err = await rejectionOf(client.post('/events/7/signup', {}), 'post()');
  assert.equal(calls.length, 3, `must re-login at most once: expected 3 fetches, got ${calls.length}`);
  assert.equal(messageOf(err), 'POST /events/7/signup → 401: {"message":"Unauthorized"}');
});

globalThis.fetch = realFetch;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
