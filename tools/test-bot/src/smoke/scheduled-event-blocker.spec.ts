#!/usr/bin/env npx tsx
/**
 * pickBlockingEvent() / findOwnChannelBlocker() / describeBlockingEvent():
 * the SE smoke tests name a foreign Active Scheduled Event on their own
 * event's voice channel when activation fails (TECH-DEBT-BACKLOG 2026-11-21).
 * Pure, no Discord connection.
 *
 * Run: npx tsx src/smoke/scheduled-event-blocker.spec.ts
 */
import assert from 'node:assert/strict';
import { GuildScheduledEventStatus } from 'discord.js';

import {
  describeBlockingEvent,
  findOwnChannelBlocker,
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
const OWN_ID = 'own-se';
const { Active, Scheduled, Completed } = GuildScheduledEventStatus;

function se(
  id: string,
  name: string,
  status: GuildScheduledEventStatus,
  channelId: string | null = CH,
): ScheduledEventLike {
  return { id, name, status, channelId };
}

const own = se(OWN_ID, 'smoke-se-complete-abc', Scheduled);

test('pick: returns the foreign Active event on the same channel', () => {
  const got = pickBlockingEvent(
    [se('1', 'other', Scheduled), se('9', 'Raid night', Active)],
    CH,
    OWN_ID,
  );
  assert.equal(got?.id, '9');
});

test('pick: ignores Active events on another channel or with no channel', () => {
  const got = pickBlockingEvent(
    [se('2', 'a', Active, 'voice-2'), se('3', 'b', Active, null)],
    CH,
    OWN_ID,
  );
  assert.equal(got, null);
});

test('pick: ignores non-Active events', () => {
  const got = pickBlockingEvent(
    [se('5', 'done', Completed), se('6', 'later', Scheduled)],
    CH,
    OWN_ID,
  );
  assert.equal(got, null);
});

test('pick: excludes the own event by id, even when Active', () => {
  const got = pickBlockingEvent([se(OWN_ID, 'anything', Active)], CH, OWN_ID);
  assert.equal(got, null);
});

test('pick: a foreign event sharing our title text still counts', () => {
  const got = pickBlockingEvent(
    [se('7', `copy of ${own.name}`, Active)],
    CH,
    OWN_ID,
  );
  assert.equal(got?.id, '7');
});

test('findOwn: uses the own event\'s channel, not a fixed one', () => {
  const ownOn2 = se(OWN_ID, own.name, Scheduled, 'voice-2');
  const got = findOwnChannelBlocker(
    [se('8', 'on 1', Active, CH), ownOn2, se('9', 'on 2', Active, 'voice-2')],
    OWN_ID,
  );
  assert.equal(got?.blocker.id, '9');
  assert.equal(got?.channelId, 'voice-2');
});

test('findOwn: null when the own event is missing or has no channel', () => {
  const blocker = se('9', 'Raid night', Active);
  assert.equal(findOwnChannelBlocker([blocker], OWN_ID), null);
  const noChannel = se(OWN_ID, own.name, Scheduled, null);
  assert.equal(findOwnChannelBlocker([noChannel, blocker], OWN_ID), null);
});

test('findOwn: null when nothing else is Active on our channel', () => {
  const got = findOwnChannelBlocker([own, se('5', 'done', Completed)], OWN_ID);
  assert.equal(got, null);
});

test('message names the id, name, channel, activation block and the fix', () => {
  const msg = describeBlockingEvent(se('9', 'Raid night', Active), CH);
  const parts = [
    '9',
    '"Raid night"',
    CH,
    'blocks activation (Scheduled -> Active)',
    'End or delete it',
  ];
  for (const part of parts) {
    assert.ok(msg.includes(part), `message lacks ${part}: ${msg}`);
  }
  assert.ok(!/new scheduled events/.test(msg), `message claims creation is blocked: ${msg}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
