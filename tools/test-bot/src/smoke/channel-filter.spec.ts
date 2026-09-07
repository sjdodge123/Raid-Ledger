#!/usr/bin/env npx tsx
/**
 * ROK-1507 — smoke channel pools by Discord type, minus ephemeral channels.
 *
 * Regression: the API "text" channel list also contains every voice channel
 * (discord.js `isTextBased()` is true for voice), and an orphaned ephemeral
 * '⏰ <game> — Playing now' voice channel sorts first, so the fixtures made a
 * VOICE channel both the default notification channel and the default voice
 * channel. Pools must be routed by real ChannelType and ephemeral names must
 * never be picked, whether or not SMOKE_CHANNEL_SET is configured.
 *
 * Run: npx tsx src/smoke/channel-filter.spec.ts
 */
import assert from 'node:assert/strict';

import {
  buildChannelPools,
  isEphemeralChannelName,
  requireTextChannel,
} from './channel-filter.js';
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

// Models the real API shape: the "text" list already contains the voice
// channels, so this is the UNION of both lists, duplicates included.
const MIXED = [
  { id: 'e1', name: '⏰ Valheim — Playing now' }, // orphan ephemeral (ROK-1494), GuildVoice
  { id: 'e2', name: 'smoke-rok1352-ephemeral-1757000000-3' }, // stale ROK-1352 ephemeral, GuildVoice
  { id: 't1', name: 'slot-1-general' }, // real GuildText
  { id: 'v1', name: 'slot-1-voice' }, // real GuildVoice
  { id: 'v1', name: 'slot-1-voice' }, // duplicate from the voice list
];
const TYPES: Record<string, number> = { e1: 2, e2: 2, t1: 0, v1: 2 };
const typeOf = (id: string) => TYPES[id];

console.log('ROK-1507 channel type / ephemeral filter');

test('AC1: pools are built from Discord type and exclude ephemeral names', () => {
  const p = buildChannelPools(MIXED, typeOf);
  assert.deepEqual(p.textChannels.map((c) => c.id), ['t1']);
  assert.deepEqual(p.voiceChannels.map((c) => c.id), ['v1']);
  assert.deepEqual(p.skipped.map((s) => s.id).sort(), ['e1', 'e2']);
  assert.deepEqual(p.skipped.map((s) => s.reason), ['ephemeral', 'ephemeral']);
});

test('AC1: a voice channel listed in the API text list never reaches the text pool', () => {
  const p = buildChannelPools([{ id: 'v9', name: 'alpha-voice' }], () => 2);
  assert.deepEqual(p.textChannels, []);
  assert.deepEqual(p.voiceChannels.map((c) => c.id), ['v9']);
});

test('unknown type is skipped, not guessed from name', () => {
  const p = buildChannelPools([{ id: 't1', name: 'slot-1-general' }], () => undefined);
  assert.deepEqual(p.textChannels, []);
  assert.deepEqual(p.voiceChannels, []);
  assert.equal(p.skipped.length, 1);
  assert.match(p.skipped[0].reason, /type=(undefined|unknown)/);
});

test('AC2: default-channel guard never returns a voice id', () => {
  assert.throws(
    () => requireTextChannel(
      { id: 'e1', name: '⏰ Valheim — Playing now', type: 2 },
      'default notification channel',
    ),
    /⏰ Valheim — Playing now[\s\S]*type=2/,
  );
  assert.throws(() => requireTextChannel(undefined, 'x'), /x: expected a GuildText/);
  assert.equal(requireTextChannel({ id: 't1', name: 'slot-1-general', type: 0 }, 'x').id, 't1');
});

test('isEphemeralChannelName matches ⏰ and smoke-*-ephemeral only', () => {
  for (const name of [
    '⏰ Valheim — Playing now', ' ⏰ x', 'smoke-rok1352-ephemeral-1', 'SMOKE-x-EPHEMERAL-2',
  ]) {
    assert.equal(isEphemeralChannelName(name), true, `expected ephemeral: ${name}`);
  }
  for (const name of ['slot-1-general', 'general-ephemeral-chat', 'town-square']) {
    assert.equal(isEphemeralChannelName(name), false, `expected NOT ephemeral: ${name}`);
  }
});

test('selectChannelSet drops ephemeral channels even when no set is configured', () => {
  const list = MIXED.slice(0, 4);
  assert.deepEqual(selectChannelSet(list, undefined).map((c) => c.id), ['t1', 'v1']);
  assert.deepEqual(selectChannelSet(list, 'slot-1').map((c) => c.id), ['t1', 'v1']);
});

test('a slot whose only channels are ephemeral still throws "matched no channels"', () => {
  assert.throws(
    () => selectChannelSet([{ id: 'e3', name: 'smoke-slot-9-ephemeral-1' }], 'smoke-slot-9'),
    /no channels/i,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
