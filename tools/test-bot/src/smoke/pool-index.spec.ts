#!/usr/bin/env npx tsx
/**
 * ROK-1522 Phase 2 — pool-index voice rotation.
 *
 * Run: npx tsx src/smoke/pool-index.spec.ts
 */
import assert from 'node:assert/strict';

import { rotateForPool, smokePoolIndex } from './pool-index.js';
import { selectChannelSet } from './channel-set.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const VOICE = [
  { id: 'v1', name: 'General' },
  { id: 's1', name: 'slot-1-voice' },
  { id: 'v2', name: 'GamerNight' },
  { id: 'v3', name: 'WoW' },
];
const first = (i: number) =>
  rotateForPool(selectChannelSet(VOICE, null), i)[0]?.name;

test('unset / blank / junk SMOKE_POOL_INDEX reads as 0', () => {
  assert.equal(smokePoolIndex({}), 0);
  assert.equal(smokePoolIndex({ SMOKE_POOL_INDEX: ' ' }), 0);
  assert.equal(smokePoolIndex({ SMOKE_POOL_INDEX: '-1' }), 0);
  assert.equal(smokePoolIndex({ SMOKE_POOL_INDEX: 'x' }), 0);
  assert.equal(smokePoolIndex({ SMOKE_POOL_INDEX: '1' }), 1);
});

test('index 0 keeps the first non-slot channel (pre-pool behaviour)', () => {
  assert.equal(first(0), 'General');
});

test('index 1 binds a DIFFERENT channel than index 0', () => {
  assert.equal(first(1), 'GamerNight');
  assert.notEqual(first(1), first(0));
});

test('the rotation wraps and never selects a slot-* channel', () => {
  assert.equal(first(3), 'General');
  for (let i = 0; i < 6; i++) assert.doesNotMatch(first(i) ?? '', /^slot-/);
});

test('rotation keeps every channel and handles an empty list', () => {
  assert.deepEqual(rotateForPool([1, 2, 3], 1), [2, 3, 1]);
  assert.deepEqual(rotateForPool([], 1), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
