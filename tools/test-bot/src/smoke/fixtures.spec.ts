#!/usr/bin/env npx tsx
/**
 * TDD failing tests for ROK-952: channelForTest() helper.
 *
 * Tests the NEW `channelForTest` function that will be exported from fixtures.ts.
 * This function distributes embed tests across a pool of channels to avoid
 * message collisions in the default notification channel.
 *
 * Run: npx tsx src/smoke/fixtures.spec.ts
 */
import assert from 'node:assert/strict';

import { channelForTest, channelForGame } from './fixtures.js';
import type { ChannelSlot } from './types.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

console.log('fixtures.spec.ts — channelForTest\n');

// --- channelForTest tests ---

test('returns defaultChannelId when channelPool is undefined', () => {
  const ctx = {
    defaultChannelId: 'ch-default-123',
  } as { defaultChannelId: string; channelPool?: ChannelSlot[] };

  const result = channelForTest(ctx, 0);
  assert.deepEqual(result, { channelId: 'ch-default-123' });
});

test('returns defaultChannelId when channelPool is empty', () => {
  const ctx = {
    defaultChannelId: 'ch-default-456',
    channelPool: [] as ChannelSlot[],
  };

  const result = channelForTest(ctx, 0);
  assert.deepEqual(result, { channelId: 'ch-default-456' });
});

test('returns pool entry at given index', () => {
  const ctx = {
    defaultChannelId: 'ch-default-789',
    channelPool: [
      { channelId: 'ch-pool-0', gameId: 1, bindingId: 'b0' },
      { channelId: 'ch-pool-1', gameId: 2, bindingId: 'b1' },
      { channelId: 'ch-pool-2', gameId: 3, bindingId: 'b2' },
    ],
  };

  const result = channelForTest(ctx, 1);
  assert.deepEqual(result, { channelId: 'ch-pool-1', gameId: 2 });
});

test('wraps around when index exceeds pool length', () => {
  const ctx = {
    defaultChannelId: 'ch-default-abc',
    channelPool: [
      { channelId: 'ch-pool-a', gameId: 1, bindingId: 'ba' },
      { channelId: 'ch-pool-b', gameId: 2, bindingId: 'bb' },
      { channelId: 'ch-pool-c', gameId: 3, bindingId: 'bc' },
    ],
  };

  // index 5 % 3 = 2, so should return pool[2]
  const result = channelForTest(ctx, 5);
  assert.deepEqual(result, { channelId: 'ch-pool-c', gameId: 3 });
});

test('returns first pool entry for index 0', () => {
  const ctx = {
    defaultChannelId: 'ch-default-xyz',
    channelPool: [
      { channelId: 'ch-pool-first', gameId: 1, bindingId: 'bf' },
      { channelId: 'ch-pool-second', gameId: 2, bindingId: 'bs' },
    ],
  };

  const result = channelForTest(ctx, 0);
  assert.deepEqual(result, { channelId: 'ch-pool-first', gameId: 1 });
});

test('wraps correctly for large index values', () => {
  const ctx = {
    defaultChannelId: 'ch-default-lg',
    channelPool: [
      { channelId: 'ch-a', gameId: 1, bindingId: 'b1' },
      { channelId: 'ch-b', gameId: 2, bindingId: 'b2' },
    ],
  };

  // index 100 % 2 = 0
  const result = channelForTest(ctx, 100);
  assert.deepEqual(result, { channelId: 'ch-a', gameId: 1 });

  // index 101 % 2 = 1
  const result2 = channelForTest(ctx, 101);
  assert.deepEqual(result2, { channelId: 'ch-b', gameId: 2 });
});

// --- channelForGame tests ---

console.log('\nfixtures.spec.ts — channelForGame\n');

test('returns defaultChannelId when gameId is undefined', () => {
  const ctx = { defaultChannelId: 'ch-def', channelPool: [{ gameId: 1, channelId: 'ch-1', bindingId: 'b1' }] };
  assert.equal(channelForGame(ctx, undefined), 'ch-def');
});

test('returns defaultChannelId when pool is empty', () => {
  const ctx = { defaultChannelId: 'ch-def', channelPool: [] };
  assert.equal(channelForGame(ctx, 5), 'ch-def');
});

test('returns bound channel when game is in pool', () => {
  const ctx = {
    defaultChannelId: 'ch-def',
    channelPool: [
      { gameId: 10, channelId: 'ch-10', bindingId: 'b10' },
      { gameId: 20, channelId: 'ch-20', bindingId: 'b20' },
    ],
  };
  assert.equal(channelForGame(ctx, 20), 'ch-20');
});

test('returns defaultChannelId when game is not in pool', () => {
  const ctx = {
    defaultChannelId: 'ch-def',
    channelPool: [{ gameId: 10, channelId: 'ch-10', bindingId: 'b10' }],
  };
  assert.equal(channelForGame(ctx, 99), 'ch-def');
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
