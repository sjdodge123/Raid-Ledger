#!/usr/bin/env npx tsx
/**
 * ROK-1460 F3 — regression tests for the Quick Play participant-count signal.
 *
 * The ROK-1243 pin ("Quick Play embed preserves every participant") needs to
 * observe a COUNT. The old `ROSTER: 1 signed up` header is gone, and the LIVE
 * chrome author line (`▸ LIVE · started 3 min ago`) carries no count at all —
 * so any predicate reading the author line is vacuous: it matches for the wrong
 * reason in the one minute that reads `started 1 min ago`, and never otherwise.
 *
 * The count now comes off the roster block via `rosterHasExactly`. These tests
 * pin that it actually discriminates 0 / 1 / 2 / overflow.
 *
 * Run: npx tsx src/smoke/roster-count.spec.ts
 */
import assert from 'node:assert/strict';

import { rosterEntries, rosterHasExactly } from './assert.js';

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

const OPEN_LINK = '[Open event ↗](http://localhost:5173/events/42)';

/** A LIVE Quick Play description, as `buildEventBody` renders it. */
function liveDescription(roster: string): string {
  return ['🔊 <#100200300>', '', roster, '', OPEN_LINK].join('\n');
}

// --- The root cause: the LIVE author line has no count to read ---

test('the LIVE author line carries no participant count', () => {
  const liveAuthor = '▸ LIVE · started 3 min ago';
  assert.equal(/\d+\s*(of|signed up|playing)/.test(liveAuthor), false);
});

// --- rosterHasExactly discriminates the count ---

test('one participant satisfies rosterHasExactly(desc, 1)', () => {
  assert.equal(rosterHasExactly(liveDescription('**TestBot**'), 1), true);
});

test('a struck participant still counts (cumulative roster)', () => {
  assert.equal(rosterHasExactly(liveDescription('~~**TestBot**~~'), 1), true);
});

test('two participants do NOT satisfy rosterHasExactly(desc, 1)', () => {
  const desc = liveDescription('**TestBot** · **Ana**');
  assert.equal(rosterHasExactly(desc, 1), false);
  assert.equal(rosterHasExactly(desc, 2), true);
});

test('an empty roster does NOT satisfy rosterHasExactly(desc, 1)', () => {
  assert.equal(rosterHasExactly(['🔊 <#1>', '', OPEN_LINK].join('\n'), 1), false);
});

test('an overflow marker fails the exact-count check', () => {
  const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => `**${n}**`).join(' · ');
  assert.equal(rosterHasExactly(liveDescription(`${six} +2 more`), 6), false);
  assert.equal(rosterHasExactly(liveDescription(six), 6), true);
});

// --- rosterEntries ignores chrome, timing, voice and link lines ---

test('the timing, voice and Open event lines are not roster entries', () => {
  const desc = [
    '📆 <t:1777658400:f> (<t:1777658400:R>) · 3h',
    '🔊 <#100200300>',
    '',
    '**TestBot**',
    '',
    OPEN_LINK,
  ].join('\n');
  assert.deepEqual(rosterEntries(desc), ['**TestBot**']);
});

test('MMO role-section headers are not counted as members', () => {
  const desc = ['🛡️ **Tanks** (1/2): **Ana**', '⚔️ **DPS** (0/3): —'].join('\n');
  assert.deepEqual(rosterEntries(desc), ['**Ana**']);
  assert.equal(rosterHasExactly(desc, 1), true);
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
