#!/usr/bin/env npx tsx
/**
 * withAdHocEventsEnabled(): the ad-hoc product gate a Quick Play spawn smoke
 * needs (ROK-1390). With the flag off, `handleVoiceJoin` returns before the
 * spawn, so the helper must turn it ON before `fn` and put it back after —
 * including when `fn` throws — and must not touch a flag that is already ON.
 * A restore that fails after a green `fn` must fail the run, not leak the flag.
 *
 * Pure: the admin client is a fake that records each call against an
 * in-memory setting. No Discord connection, no API, no timers.
 *
 * Run: npx tsx src/smoke/fixtures-quick-play.spec.ts
 */
import assert from 'node:assert/strict';

import { withAdHocEventsEnabled, type AdHocGateApi } from './fixtures-quick-play.js';

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

/** A fake admin client over one in-memory `ad_hoc_events_enabled` value. */
function fakeApi(initial: boolean) {
  const state = { enabled: initial, calls: [] as string[] };
  const api: AdHocGateApi = {
    get: <T>(path: string): Promise<T> => {
      state.calls.push(`GET ${path}`);
      return Promise.resolve({ enabled: state.enabled } as T);
    },
    put: <T>(path: string, body: unknown): Promise<T> => {
      state.calls.push(`PUT ${path} ${JSON.stringify(body)}`);
      state.enabled = (body as { enabled: boolean }).enabled;
      return Promise.resolve({ success: true } as T);
    },
  };
  return { api, state };
}

const PATH = '/admin/settings/discord-bot/ad-hoc';

console.log('\nwithAdHocEventsEnabled');

await test('flag OFF: enabled while fn runs, restored to OFF after', async () => {
  const { api, state } = fakeApi(false);
  let seenInside: boolean | null = null;
  const out = await withAdHocEventsEnabled(api, () => {
    seenInside = state.enabled;
    return Promise.resolve('result');
  });
  assert.equal(seenInside, true, 'fn must run with ad-hoc events ON');
  assert.equal(out, 'result', "fn's return value must pass through");
  assert.equal(state.enabled, false, 'the prior OFF value must be restored');
  assert.deepEqual(state.calls, [
    `GET ${PATH}`,
    `PUT ${PATH} {"enabled":true}`,
    `PUT ${PATH} {"enabled":false}`,
  ]);
});

await test('flag OFF and fn throws: restored to OFF, fn error propagates', async () => {
  const { api, state } = fakeApi(false);
  await assert.rejects(
    withAdHocEventsEnabled(api, () => Promise.reject(new Error('seam refused'))),
    /seam refused/,
  );
  assert.equal(state.enabled, false, 'a throwing fn must still restore OFF');
});

await test('flag already ON: no write at all, stays ON', async () => {
  const { api, state } = fakeApi(true);
  await withAdHocEventsEnabled(api, () => Promise.resolve());
  assert.equal(state.enabled, true, 'a flag that was ON must stay ON');
  assert.deepEqual(state.calls, [`GET ${PATH}`], 'no PUT when already ON');
});

/** A fake whose second PUT (the restore) fails. */
function restoreFails(): { api: AdHocGateApi; state: { enabled: boolean } } {
  const { api, state } = fakeApi(false);
  let puts = 0;
  const flaky: AdHocGateApi = {
    get: api.get,
    put: <T>(path: string, body: unknown): Promise<T> => {
      puts += 1;
      if (puts === 2) return Promise.reject(new Error('restore 500'));
      return api.put<T>(path, body);
    },
  };
  return { api: flaky, state };
}

await test('a failed restore does not mask the error fn threw', async () => {
  const { api } = restoreFails();
  await assert.rejects(
    withAdHocEventsEnabled(api, () => Promise.reject(new Error('fn failed'))),
    /fn failed/,
  );
});

await test('a failed restore after a green fn fails the run', async () => {
  const { api, state } = restoreFails();
  await assert.rejects(
    withAdHocEventsEnabled(api, () => Promise.resolve('ok')),
    /ad-hoc gate restore failed; the flag stays ON: restore 500/,
    'a green fn whose restore failed must reject, not leave the flag ON silently',
  );
  assert.equal(state.enabled, true, 'the fake must show the flag leaked ON');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
