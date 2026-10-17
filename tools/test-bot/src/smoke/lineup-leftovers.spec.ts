#!/usr/bin/env npx tsx
/**
 * archiveOwnLeftoverLineups(): a smoke file retires ONLY its own lineups from
 * EARLIER runs (TDB:1999). At SMOKE_CONCURRENCY > 1 it must never touch a
 * sibling file's lineup, nor its own file's lineup created during this run.
 *
 * Pure: the ApiClient is an injected fake that records every call. No
 * Discord connection, no API, no timers.
 *
 * Run: npx tsx src/smoke/lineup-leftovers.spec.ts
 */
import assert from 'node:assert/strict';

import type { ApiClient } from './api.js';
import { archiveOwnLeftoverLineups } from './lineup-leftovers.js';

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

const RUN_STARTED_AT = 1_700_000_000_000;
const BEFORE = RUN_STARTED_AT - 60_000;
const AFTER = RUN_STARTED_AT + 5;

interface FakeOpts {
  active?: unknown;
  getRejects?: boolean;
  abortRejects?: boolean;
}

/** Fake ApiClient: GET /lineups/active returns `active`; writes are logged. */
function fakeApi(opts: FakeOpts) {
  const calls: string[] = [];
  const api = {
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      if (opts.getRejects) throw new Error('GET /lineups/active failed: 500');
      return opts.active;
    },
    patch: async (path: string, body: unknown) => {
      calls.push(`PATCH ${path} ${JSON.stringify(body)}`);
      return {};
    },
    post: async (path: string) => {
      calls.push(`POST ${path}`);
      if (opts.abortRejects) throw new Error(`POST ${path} failed: 404`);
      return {};
    },
  } as unknown as ApiClient;
  return { api, calls };
}

const archived = (id: number) =>
  `PATCH /lineups/${id}/status {"status":"archived"}`;
const writes = (calls: string[]) => calls.filter((c) => !c.startsWith('GET '));

console.log('\narchiveOwnLeftoverLineups');

await test('(a) an own-prefix row stamped before the run start is archived', async () => {
  const { api, calls } = fakeApi({
    active: [{ id: 1, title: `Tie Hold ${BEFORE}` }],
  });
  await archiveOwnLeftoverLineups(api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(writes(calls), [archived(1)]);
});

await test('(b) an own-prefix row stamped at or after the run start is left alone', async () => {
  const { api, calls } = fakeApi({
    active: [
      { id: 2, title: `Tie Hold ${RUN_STARTED_AT}` },
      { id: 3, title: `Tie Hold ${AFTER}` },
    ],
  });
  await archiveOwnLeftoverLineups(api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(
    writes(calls),
    [],
    `a same-run sibling's lineup was retired: ${writes(calls).join(', ')}`,
  );
});

await test("(c) another file's prefix is never touched, even when stale", async () => {
  const { api, calls } = fakeApi({
    active: [
      { id: 4, title: `Private Smoke 1` },
      { id: 5, title: `Private Smoke ${BEFORE}` },
      { id: 6, title: `Tie Hold ${BEFORE}` },
    ],
  });
  await archiveOwnLeftoverLineups(api, ['Tie Hold ', 'Tie Pick '], RUN_STARTED_AT);
  assert.deepEqual(writes(calls), [archived(6)]);
});

await test('(d) a non-numeric suffix after the prefix counts as a leftover', async () => {
  const { api, calls } = fakeApi({
    active: [{ id: 7, title: 'Tie Hold 123 (b)' }],
  });
  await archiveOwnLeftoverLineups(api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(writes(calls), [archived(7)]);
});

await test("(e) retire:'abort' POSTs /abort and falls back to the archive PATCH", async () => {
  const ok = fakeApi({ active: [{ id: 8, title: `Abort Reason ${BEFORE}` }] });
  await archiveOwnLeftoverLineups(ok.api, ['Abort Reason '], RUN_STARTED_AT, {
    retire: 'abort',
  });
  assert.deepEqual(writes(ok.calls), ['POST /lineups/8/abort']);

  const refused = fakeApi({
    active: [{ id: 9, title: `Abort Reason ${BEFORE}` }],
    abortRejects: true,
  });
  await archiveOwnLeftoverLineups(refused.api, ['Abort Reason '], RUN_STARTED_AT, {
    retire: 'abort',
  });
  assert.deepEqual(writes(refused.calls), ['POST /lineups/9/abort', archived(9)]);
});

await test('(f) a single-object response is handled and a rejected GET is a no-op', async () => {
  const single = fakeApi({ active: { id: 10, title: `Tie Hold ${BEFORE}` } });
  await archiveOwnLeftoverLineups(single.api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(writes(single.calls), [archived(10)]);

  const empty = fakeApi({ active: null });
  await archiveOwnLeftoverLineups(empty.api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(writes(empty.calls), []);

  const down = fakeApi({ getRejects: true });
  await archiveOwnLeftoverLineups(down.api, ['Tie Hold '], RUN_STARTED_AT);
  assert.deepEqual(down.calls, ['GET /lineups/active']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
