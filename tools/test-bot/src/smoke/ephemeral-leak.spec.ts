#!/usr/bin/env npx tsx
/**
 * End-of-run ephemeral voice census (INV-DEV-GUILD-FLOOD-2026-10-15).
 *
 * Regression: a smoke leaked one `⏰ <game> — Playing now` channel per CI run
 * for a week and nothing said so. The census must count exactly the
 * ephemeral VOICE channels created during the run — not older ones, not text
 * channels, not ordinary voice channels.
 *
 * Run: npx tsx src/smoke/ephemeral-leak.spec.ts
 */
import assert from 'node:assert/strict';

import {
  findEphemeralVoiceSince,
  formatEphemeralLeakReport,
  snowflakeTimestampMs,
} from './ephemeral-leak.js';

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
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A snowflake id whose encoded creation time is `ms`. */
function idAt(ms: number): string {
  return ((BigInt(ms) - 1_420_070_400_000n) << 22n).toString();
}

const RUN_START = Date.parse('2026-10-15T13:00:00Z');
const BEFORE = RUN_START - 60_000;
const DURING = RUN_START + 60_000;

console.log('ephemeral voice leak census');

test('decodes a real snowflake (the INV report\'s legacy orphan, 2026-06-27)', () => {
  const ms = snowflakeTimestampMs('1520461975442948177');
  assert.equal(new Date(ms ?? 0).toISOString().slice(0, 10), '2026-06-27');
});

test('a non-snowflake id decodes to null', () => {
  assert.equal(snowflakeTimestampMs('not-an-id'), null);
});

test('counts only ephemeral VOICE channels created during the run', () => {
  const channels = [
    { id: idAt(DURING), name: '⏰ Chao Chao — Playing now', type: 2 },
    { id: idAt(DURING), name: 'smoke-rok1352-ephemeral-1-x', type: 2 },
    { id: idAt(BEFORE), name: '⏰ Chao Chao — Playing now', type: 2 },
    { id: idAt(DURING), name: '⏰ chat', type: 0 },
    { id: idAt(DURING), name: 'slot-1-voice', type: 2 },
  ];
  const leaks = findEphemeralVoiceSince(channels, RUN_START);
  assert.deepEqual(
    leaks.map((c) => c.name),
    ['⏰ Chao Chao — Playing now', 'smoke-rok1352-ephemeral-1-x'],
  );
});

test('a channel created at the exact run start counts', () => {
  const leaks = findEphemeralVoiceSince([{ id: idAt(RUN_START), name: '⏰ X', type: 2 }], RUN_START);
  assert.equal(leaks.length, 1);
});

test('report: a clean run is one quiet line with no warning', () => {
  const lines = formatEphemeralLeakReport([], RUN_START, true);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0] ?? '', /WARNING|::warning/);
});

test('report: leaks give the count, every channel, and a GitHub annotation', () => {
  const leak = { id: '123', name: '⏰ Chao Chao — Playing now', type: 2 };
  const lines = formatEphemeralLeakReport([leak, leak], RUN_START, true);
  assert.match(lines[0] ?? '', /WARNING: 2 ephemeral voice channel/);
  assert.equal(lines.filter((l) => l.includes('(123)')).length, 2);
  assert.match(lines.at(-1) ?? '', /^::warning title=[^:]+::2 ephemeral/);
});

test('report: no GitHub annotation outside Actions', () => {
  const lines = formatEphemeralLeakReport([{ id: '1', name: '⏰ X', type: 2 }], RUN_START, false);
  assert.equal(lines.some((l) => l.startsWith('::warning')), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
