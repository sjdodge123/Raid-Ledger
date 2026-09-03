#!/usr/bin/env npx tsx
/**
 * ROK-1469 D5 — per-slot channel sets.
 *
 * Two fleet envs pointed at one guild used to bind the SAME text/voice
 * channels, so slot-1's embed landed in the channel slot-2 was asserting on.
 * `SMOKE_CHANNEL_SET=slot-N` restricts discovery to the channels named
 * `slot-N-*`, giving each slot a disjoint set; unset keeps today's behavior
 * (single-host laptop runs, where no cross-slot contention exists).
 *
 * The empty-match case FAILS LOUD on purpose: silently falling back to the
 * full channel list would reintroduce exactly the collision this exists to
 * prevent, and it would do it invisibly.
 *
 * Run: npx tsx src/smoke/channel-set.spec.ts
 */
import assert from 'node:assert/strict';

import { channelSetPrefix, selectChannelSet } from './channel-set.js';

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

const CHANNELS = [
  { id: '1', name: 'slot-1-general' },
  { id: '2', name: 'slot-1-raids' },
  { id: '3', name: 'slot-2-general' },
  { id: '4', name: 'town-square' },
];

console.log('ROK-1469 channel sets');

test('unset channel set → every channel is usable (unchanged behavior)', () => {
  assert.deepEqual(selectChannelSet(CHANNELS, undefined), CHANNELS);
  assert.deepEqual(selectChannelSet(CHANNELS, ''), CHANNELS);
  assert.deepEqual(selectChannelSet(CHANNELS, '   '), CHANNELS);
});

test('slot-1 selects only its own channels', () => {
  const picked = selectChannelSet(CHANNELS, 'slot-1');
  assert.deepEqual(picked.map((c) => c.id), ['1', '2']);
});

test('slot-2 never sees slot-1 channels (the collision this prevents)', () => {
  const picked = selectChannelSet(CHANNELS, 'slot-2');
  assert.deepEqual(picked.map((c) => c.name), ['slot-2-general']);
});

test('prefix match is anchored — "general" does not match a suffix', () => {
  assert.throws(() => selectChannelSet(CHANNELS, 'general'), /no channels/i);
});

test('an unmatched set throws instead of silently sharing channels', () => {
  assert.throws(() => selectChannelSet(CHANNELS, 'slot-9'), /slot-9/);
});

test('matching is case-insensitive and tolerates a trailing dash', () => {
  const upper = selectChannelSet(CHANNELS, 'SLOT-1');
  assert.deepEqual(upper.map((c) => c.id), ['1', '2']);
  const dashed = selectChannelSet(CHANNELS, 'slot-1-');
  assert.deepEqual(dashed.map((c) => c.id), ['1', '2']);
});

test('channelSetPrefix reads SMOKE_CHANNEL_SET and normalizes blanks to null', () => {
  assert.equal(channelSetPrefix({ SMOKE_CHANNEL_SET: 'slot-3' }), 'slot-3');
  assert.equal(channelSetPrefix({ SMOKE_CHANNEL_SET: '  ' }), null);
  assert.equal(channelSetPrefix({}), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
