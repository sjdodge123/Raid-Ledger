#!/usr/bin/env npx tsx
/**
 * Pure helpers behind the ROK-2201 reschedule-a-started-event smoke.
 *
 * The smoke moves an event whose Discord Scheduled Event is already ACTIVE
 * ~3 h later and must see (a) the old SE ended or gone and (b) a NEW,
 * SCHEDULED SE for the same event at the new start. These helpers decide both
 * from plain snapshots so the decision is gated without a guild.
 *
 * Run: npx tsx src/smoke/reschedule-started.spec.ts
 */
import assert from 'node:assert/strict';

import {
  SE_STATUS,
  describeRescheduleState,
  findRecreatedSe,
  isEndedSeStatus,
  type SeSnapshot,
} from './reschedule-started.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(err as Error).message}`);
  }
}

const TITLE = 'smoke-se-resched-started-abc123';
const NEW_START = Date.parse('2026-11-14T20:00:00.000Z');
const TOL = 60_000;

function se(over: Partial<SeSnapshot>): SeSnapshot {
  return {
    id: '200',
    name: TITLE,
    status: SE_STATUS.Scheduled,
    startMs: NEW_START,
    ...over,
  };
}

console.log('\nisEndedSeStatus');

test('gone (null) counts as ended', () => {
  assert.equal(isEndedSeStatus(null), true);
});
test('Completed and Canceled count as ended', () => {
  assert.equal(isEndedSeStatus(SE_STATUS.Completed), true);
  assert.equal(isEndedSeStatus(SE_STATUS.Canceled), true);
});
test('Active and Scheduled are NOT ended', () => {
  assert.equal(isEndedSeStatus(SE_STATUS.Active), false);
  assert.equal(isEndedSeStatus(SE_STATUS.Scheduled), false);
});

console.log('\nfindRecreatedSe');

test('finds a new Scheduled SE for the title at the new start', () => {
  const hit = findRecreatedSe([se({})], TITLE, '100', NEW_START, TOL);
  assert.equal(hit?.id, '200');
});
test('ignores the old SE id even when it matches everything else', () => {
  const old = se({ id: '100' });
  assert.equal(findRecreatedSe([old], TITLE, '100', NEW_START, TOL), null);
});
test('ignores an SE that is not Scheduled', () => {
  const active = se({ status: SE_STATUS.Active });
  assert.equal(findRecreatedSe([active], TITLE, '100', NEW_START, TOL), null);
});
test('ignores an SE at the OLD start (outside the tolerance)', () => {
  const stale = se({ startMs: NEW_START - 3 * 3_600_000 });
  assert.equal(findRecreatedSe([stale], TITLE, '100', NEW_START, TOL), null);
});
test('ignores another event\'s SE', () => {
  const other = se({ name: 'smoke-other-event' });
  assert.equal(findRecreatedSe([other], TITLE, '100', NEW_START, TOL), null);
});
test('accepts a game-suffixed name that contains the title', () => {
  const named = se({ name: `${TITLE} — Valheim` });
  assert.equal(findRecreatedSe([named], TITLE, '100', NEW_START, TOL)?.id, '200');
});
test('accepts a start within the tolerance (rounding)', () => {
  const near = se({ startMs: NEW_START + 999 });
  assert.equal(findRecreatedSe([near], TITLE, '100', NEW_START, TOL)?.id, '200');
});

console.log('\ndescribeRescheduleState');

test('names the old SE status and every SE for the title', () => {
  const text = describeRescheduleState('100', SE_STATUS.Active, [
    se({ id: '100', status: SE_STATUS.Active, startMs: NEW_START - 1000 }),
  ]);
  assert.match(text, /old SE 100 is Active/);
  assert.match(text, /100 Active @ 2026-11-14T19:59:59\.000Z/);
});
test('says "gone" for a missing old SE and "none" for no SEs', () => {
  const text = describeRescheduleState('100', null, []);
  assert.match(text, /old SE 100 is gone/);
  assert.match(text, /SEs for the event: none/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
