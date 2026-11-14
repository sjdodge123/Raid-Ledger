#!/usr/bin/env npx tsx
/**
 * loginWithRetry — a gateway stall on the first companion login is retried
 * once on a fresh client; a real failure fails every attempt and surfaces the
 * last error; a failed attempt is always cleaned up before the next starts.
 * waitForReady — times out, resolves on ready, rejects on a login error.
 *
 * Pure — no Discord connection, no API, no env.
 *
 * Run: npx tsx src/smoke/login-retry.spec.ts
 */
import assert from 'node:assert/strict';

import { loginWithRetry, waitForReady } from '../login-retry.js';

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

console.log('login-retry');

await test('first attempt succeeds → no retry, no cleanup', async () => {
  const events: string[] = [];
  const out = await loginWithRetry({
    attempt: async () => { events.push('attempt'); return 'client-1'; },
    cleanup: async () => { events.push('cleanup'); },
    attempts: 2,
  });
  assert.equal(out, 'client-1');
  assert.deepEqual(events, ['attempt']);
});

await test('first attempt times out → cleaned up, second attempt wins', async () => {
  const events: string[] = [];
  const logs: string[] = [];
  let n = 0;
  const out = await loginWithRetry({
    attempt: async () => {
      n++;
      events.push(`attempt${n}`);
      if (n === 1) throw new Error('Bot login timed out after 30s');
      return `client-${n}`;
    },
    cleanup: async () => { events.push('cleanup'); },
    attempts: 2,
    log: (m) => logs.push(m),
  });
  assert.equal(out, 'client-2');
  assert.deepEqual(events, ['attempt1', 'cleanup', 'attempt2']);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', /attempt 1\/2 failed \(Bot login timed out after 30s\); retrying/);
});

await test('every attempt fails → throws the LAST error, never loops', async () => {
  let n = 0;
  let cleanups = 0;
  await assert.rejects(
    loginWithRetry({
      attempt: async () => { n++; throw new Error(`fail ${n}`); },
      cleanup: async () => { cleanups++; },
      attempts: 2,
    }),
    /fail 2/,
  );
  assert.equal(n, 2);
  assert.equal(cleanups, 2);
});

await test('waitForReady resolves when ready fires', async () => {
  let fire: (() => void) | undefined;
  const p = waitForReady(async () => undefined, (cb) => { fire = cb; }, 1_000);
  assert.ok(fire, 'onReady callback registered');
  fire();
  await p;
});

await test('waitForReady rejects with the timeout message', async () => {
  await assert.rejects(
    waitForReady(async () => undefined, () => undefined, 20),
    /Bot login timed out after 0.02s/,
  );
});

await test('waitForReady rejects on a login error', async () => {
  await assert.rejects(
    waitForReady(async () => { throw new Error('An invalid token was provided.'); }, () => undefined, 1_000),
    /invalid token/,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
