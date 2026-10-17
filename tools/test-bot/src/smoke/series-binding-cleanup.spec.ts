#!/usr/bin/env npx tsx
/**
 * deleteSeriesBindings — the series dual-binding smoke tests' teardown.
 *
 * Regression: those tests collected binding ids from the admin list only after
 * both /bind calls. A refused second bind threw before the list was read, so
 * the first binding stayed in the shared smoke guild. The sweep must find and
 * delete it from the list alone, and must never throw out of a finally block.
 *
 * Run: npx tsx src/smoke/series-binding-cleanup.spec.ts
 */
import assert from 'node:assert/strict';

import {
  deleteSeriesBindings,
  type BindingSweepApi,
  type SeriesBindingRow,
} from './series-binding-cleanup.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(err as Error).message}`);
  }
}

/** A fake admin API holding `rows`; records every delete path. */
function fakeApi(listing: () => unknown): BindingSweepApi & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    get: <T>() => Promise.resolve(listing() as T),
    delete: (path: string) => {
      deleted.push(path);
      return Promise.resolve();
    },
  };
}

const ROWS: SeriesBindingRow[] = [
  { id: 'text-g1', recurrenceGroupId: 'g1' },
  { id: 'other-series', recurrenceGroupId: 'g2' },
  { id: 'no-series', recurrenceGroupId: null },
];

await test('a first bind left behind by a refused second bind is deleted', async () => {
  const api = fakeApi(() => ({ data: ROWS }));
  await deleteSeriesBindings(api, 'g1');
  assert.deepEqual(
    api.deleted,
    ['/admin/discord/bindings/text-g1'],
    'the series binding saved before the refusal was not deleted',
  );
});

await test('every binding of the series goes, and no other', async () => {
  const rows = [...ROWS, { id: 'voice-g1', recurrenceGroupId: 'g1' }];
  const api = fakeApi(() => rows);
  const ids = await deleteSeriesBindings(api, 'g1');
  assert.deepEqual(ids, ['text-g1', 'voice-g1'], 'wrong rows swept');
  assert.equal(api.deleted.length, 2, `deleted ${JSON.stringify(api.deleted)}`);
});

await test('a failing list call does not throw out of the finally block', async () => {
  const api = fakeApi(() => {
    throw new Error('list failed');
  });
  await assert.doesNotReject(
    deleteSeriesBindings(api, 'g1'),
    'the sweep threw and would mask the test failure',
  );
});

await test('a failing delete does not stop the rest of the sweep', async () => {
  const rows = [
    { id: 'a', recurrenceGroupId: 'g1' },
    { id: 'b', recurrenceGroupId: 'g1' },
  ];
  const tried: string[] = [];
  const api: BindingSweepApi = {
    get: <T>() => Promise.resolve(rows as T),
    delete: (path: string) => {
      tried.push(path);
      return Promise.reject(new Error('404'));
    },
  };
  await assert.doesNotReject(
    deleteSeriesBindings(api, 'g1'),
    'a failed delete escaped the sweep',
  );
  assert.equal(tried.length, 2, `only tried ${JSON.stringify(tried)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
