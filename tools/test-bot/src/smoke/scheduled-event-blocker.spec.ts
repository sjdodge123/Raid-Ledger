#!/usr/bin/env npx tsx
/**
 * pickBlockingEvent() / describeBlockingEvent(): the SE smoke tests name a
 * foreign Active Scheduled Event on their voice channel instead of timing
 * out (TECH-DEBT-BACKLOG 2026-11-21). Pure, no Discord connection.
 *
 * Run: npx tsx src/smoke/scheduled-event-blocker.spec.ts
 */
import assert from 'node:assert/strict';
import { GuildScheduledEventStatus } from 'discord.js';

import {
  describeBlockingEvent,
  pickBlockingEvent,
  type ScheduledEventLike,
} from './scheduled-event-blocker.js';

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

const CH = 'voice-1';
const OWN = 'smoke-se-create-abc123';

function se(
  id: string,
  name: string,
  status: GuildScheduledEventStatus,
  channelId: string | null = CH,
): ScheduledEventLike {
  return { id, name, status, channelId };
}

test('returns the foreign Active event on the same channel', () => {
  const blocker = se('9', 'Raid night', GuildScheduledEventStatus.Active);
  const got = pickBlockingEvent(
    [se('1', 'other', GuildScheduledEventStatus.Scheduled), blocker],
    CH,
    OWN,
  );
  assert.equal(got?.id, '9');
});

test('ignores Active events on another channel or with no channel', () => {
  const got = pickBlockingEvent(
    [
      se('2', 'a', GuildScheduledEventStatus.Active, 'voice-2'),
      se('3', 'b', GuildScheduledEventStatus.Active, null),
    ],
    CH,
    OWN,
  );
  assert.equal(got, null);
});

test('ignores non-Active events and the test\'s own event', () => {
  const got = pickBlockingEvent(
    [
      se('4', `[x] ${OWN}`, GuildScheduledEventStatus.Active),
      se('5', 'done', GuildScheduledEventStatus.Completed),
      se('6', 'later', GuildScheduledEventStatus.Scheduled),
    ],
    CH,
    OWN,
  );
  assert.equal(got, null);
});

test('the message names the event id, name, channel id and the block', () => {
  const msg = describeBlockingEvent(
    se('9', 'Raid night', GuildScheduledEventStatus.Active),
    CH,
    OWN,
  );
  for (const part of ['9', '"Raid night"', CH, OWN, 'blocks new scheduled events']) {
    assert.ok(msg.includes(part), `message lacks ${part}: ${msg}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
