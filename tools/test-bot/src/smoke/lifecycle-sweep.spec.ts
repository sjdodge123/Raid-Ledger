#!/usr/bin/env npx tsx
/**
 * isSweepableLifecycleLeftover(): the channel-lifecycle smoke's leftover sweep
 * must never delete a `smoke-lc-*` channel a concurrent run on the other lease
 * slot is still using (2026-11-27: PR #2378's run lost its channel mid-test to
 * PR #2381's sweep). Only prefix matches older than the minimum age go.
 *
 * Pure: no Discord connection, no API, no timers.
 *
 * Run: npx tsx src/smoke/lifecycle-sweep.spec.ts
 */
import assert from 'node:assert/strict';

import {
  isSweepableLifecycleLeftover,
  LIFECYCLE_SWEEP_MIN_AGE_MS,
} from '../helpers/lifecycle-channels.js';

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

const NOW = Date.UTC(2026, 10, 27, 12, 30);

test('a fresh smoke-lc channel (a concurrent run) is kept', () => {
  assert.equal(isSweepableLifecycleLeftover('smoke-lc-mwyyfyw3-lc', NOW - 60_000, NOW), false);
});

test('a smoke-lc channel just under the minimum age is kept', () => {
  assert.equal(
    isSweepableLifecycleLeftover('smoke-lc-games-abc', NOW - LIFECYCLE_SWEEP_MIN_AGE_MS + 1, NOW),
    false,
  );
});

test('a smoke-lc channel at or past the minimum age is swept', () => {
  assert.equal(isSweepableLifecycleLeftover('smoke-lc-games-abc', NOW - LIFECYCLE_SWEEP_MIN_AGE_MS, NOW), true);
  assert.equal(isSweepableLifecycleLeftover('smoke-lc-archived-abc', NOW - 3 * 3_600_000, NOW), true);
});

test('an old channel without the prefix is never swept', () => {
  assert.equal(isSweepableLifecycleLeftover('general', NOW - 30 * 86_400_000, NOW), false);
  assert.equal(isSweepableLifecycleLeftover('smoke-lfg-old', NOW - 30 * 86_400_000, NOW), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
