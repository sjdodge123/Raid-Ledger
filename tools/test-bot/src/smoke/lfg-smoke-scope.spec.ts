#!/usr/bin/env npx tsx
/**
 * ROK-1522 — the LFG smoke scope: which games each suite scans, and which
 * forum threads an LFM test's teardown may delete.
 *
 * The sweep deletes real Discord threads in a guild other runs and the
 * operator share, so its filter must FAIL CLOSED: another bot's thread, a
 * thread that predates the run, the intro post, or a sibling test's group
 * must never qualify.
 *
 * Run: npx tsx src/smoke/lfg-smoke-scope.spec.ts
 */
import assert from 'node:assert/strict';

import {
  BOARD_SCAN_OFFSET,
  GAME_SCAN_LIMIT,
  LFM_SCAN_OFFSET,
  SWEEP_CLOCK_SKEW_MS,
  boardCandidates,
  isSweepableThread,
  lfmCandidates,
  snowflakeTimestampMs,
  type SweepScope,
} from './lfg-smoke-scope.js';

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

/** The full seed: 31 games, id 1 oldest, id 31 newest (Chao Chao). */
const FULL = Array.from({ length: 31 }, (_, i) => i + 1);
/** The CI seed: seven games. */
const CI = Array.from({ length: 7 }, (_, i) => i + 1);

test('LFM window skips the newest games (never Chao Chao on the full seed)', () => {
  const lfm = lfmCandidates(FULL);
  assert.equal(lfm.length, GAME_SCAN_LIMIT);
  assert.ok(!lfm.includes(31), `LFM window must not hold the newest game, got [${lfm}]`);
  assert.deepEqual(lfm, [15, 14, 13, 12, 11, 10, 9, 8]);
});

test('LFM and board windows are disjoint on the full seed', () => {
  const board = boardCandidates(FULL);
  const shared = lfmCandidates(FULL).filter((g) => board.includes(g));
  assert.deepEqual(shared, [], `windows overlap on [${shared}]`);
  assert.deepEqual(board, [23, 22, 21, 20, 19, 18, 17, 16]);
  assert.equal(LFM_SCAN_OFFSET, BOARD_SCAN_OFFSET + GAME_SCAN_LIMIT);
});

test('short registry keeps the pre-ROK-1522 fallbacks (LFM newest-first, board oldest-first)', () => {
  assert.deepEqual(lfmCandidates(CI), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(boardCandidates(CI), [1, 2, 3, 4, 5, 6, 7]);
});

test('a mid-size registry that fits only the board window stays disjoint', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => i + 1);
  const board = boardCandidates(twelve);
  const shared = lfmCandidates(twelve).filter((g) => board.includes(g));
  assert.deepEqual(shared, [], `windows overlap on [${shared}]`);
});

const DISCORD_EPOCH_MS = 1_420_070_400_000;
const idAt = (ms: number): string => String(BigInt(ms - DISCORD_EPOCH_MS) << 22n);
const ARMED = Date.UTC(2026, 8, 25, 12, 0, 0);
const OUR_BOT = '1400000000000000001';
const OTHER_BOT = '1400000000000000002';
const PREFIX = 'Halo · ';
const scope = (over: Partial<SweepScope> = {}): SweepScope => ({
  botUserId: OUR_BOT,
  sinceMs: ARMED,
  preexisting: new Set<string>(),
  namePrefix: PREFIX,
  ...over,
});
const ours = { id: idAt(ARMED + 5_000), name: 'Halo · 2 looking', ownerId: OUR_BOT };

test('snowflake timestamps round-trip', () => {
  assert.equal(snowflakeTimestampMs(idAt(ARMED)), ARMED);
});

test('a new thread by our bot, named for our game, is swept', () => {
  assert.equal(isSweepableThread(ours, scope()), true);
});

test("another bot's thread is never swept", () => {
  assert.equal(isSweepableThread({ ...ours, ownerId: OTHER_BOT }, scope()), false);
  assert.equal(isSweepableThread({ ...ours, ownerId: null }, scope()), false);
});

test('an unknown bot id deletes nothing (fails closed)', () => {
  assert.equal(isSweepableThread(ours, scope({ botUserId: null })), false);
});

test('a thread present when the sweep was armed is never swept', () => {
  assert.equal(isSweepableThread(ours, scope({ preexisting: new Set([ours.id]) })), false);
});

test('a thread older than the arm time (beyond the skew allowance) is never swept', () => {
  const old = { ...ours, id: idAt(ARMED - SWEEP_CLOCK_SKEW_MS - 1) };
  assert.equal(isSweepableThread(old, scope()), false);
});

test('a thread for another game, or the intro post, is never swept', () => {
  assert.equal(isSweepableThread({ ...ours, name: 'Halo Infinite · 2 looking' }, scope()), false);
  const intro = { ...ours, name: '➕ Post an LFG here · How this board works' };
  assert.equal(isSweepableThread(intro, scope()), false);
});

test('a malformed id is never swept', () => {
  assert.equal(isSweepableThread({ ...ours, id: 'not-a-snowflake' }, scope()), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
