#!/usr/bin/env npx tsx
/**
 * ROK-1511: deleteEvent must drain the queues BEFORE deleting the event row,
 * or an in-flight embed-post job hits the discord_event_messages FK.
 *
 * Run: npx tsx src/smoke/fixtures-teardown.spec.ts
 */
import assert from 'node:assert/strict';

import { deleteEvent } from './fixtures.js';
import type { ApiClient } from './api.js';

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

function fakeApi(opts: { postRejects?: boolean; deleteRejects?: boolean } = {}) {
  const calls: string[] = [];
  const api = {
    post: async (path: string) => {
      calls.push(`POST ${path}`);
      if (opts.postRejects) throw new Error('POST /admin/test/await-processing → 409');
      return {};
    },
    delete: async (path: string) => {
      calls.push(`DELETE ${path}`);
      if (opts.deleteRejects) throw new Error('DELETE failed → 500');
      return {};
    },
  } as unknown as ApiClient;
  return { api, calls };
}

console.log('fixtures-teardown.spec.ts — deleteEvent drain ordering (ROK-1511)\n');

await test(
  'deleteEvent drains queues via await-processing BEFORE issuing the event DELETE',
  async () => {
    const { api, calls } = fakeApi();
    await deleteEvent(api, 7);
    assert.deepEqual(calls, [
      'POST /admin/test/await-processing',
      'DELETE /events/7',
    ]);
  },
);

await test('deleteEvent still deletes the event when await-processing fails', async () => {
  const { api, calls } = fakeApi({ postRejects: true });
  await deleteEvent(api, 7);
  assert.deepEqual(calls, [
    'POST /admin/test/await-processing',
    'DELETE /events/7',
  ]);
});

await test('deleteEvent swallows a failing DELETE', async () => {
  const { api, calls } = fakeApi({ deleteRejects: true });
  await deleteEvent(api, 7);
  assert.deepEqual(calls, [
    'POST /admin/test/await-processing',
    'DELETE /events/7',
  ]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
