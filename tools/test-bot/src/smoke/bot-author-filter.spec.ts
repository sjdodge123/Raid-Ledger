#!/usr/bin/env npx tsx
/**
 * ROK-1469 D4 — the smoke bot filters channel reads by the API bot's user id.
 *
 * Fleet envs run per-slot Discord applications. Two envs pointed at the same
 * guild would otherwise let slot-1's embeds satisfy a slot-2 assertion (and
 * vice versa) — a false PASS, the worst failure mode a smoke suite has. The
 * filter pins every `readLastMessages` result to the bot the env under test
 * is actually running as.
 *
 * Fail-open by design: when the id can't be resolved (bot not connected, old
 * API without botUserId), NO filtering happens. A wrong filter id would hide
 * every real message and read as a mass timeout.
 *
 * Run: npx tsx src/smoke/bot-author-filter.spec.ts
 */
import assert from 'node:assert/strict';

import {
  filterByApiBot,
  getApiBotUserId,
  isFromApiBot,
  resolveApiBotUserId,
  shouldAcceptMessage,
  setApiBotUserId,
} from '../helpers/bot-author.js';
import type { SimpleMessage } from '../helpers/messages.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err: unknown) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    });
}

function msg(authorId: string, content = ''): SimpleMessage {
  return {
    id: `m-${authorId}-${content}`,
    authorId,
    authorTag: `bot-${authorId}#0`,
    content,
    embeds: [],
    components: [],
    timestamp: new Date(),
    editedAt: null,
  };
}

async function main(): Promise<void> {
  console.log('ROK-1469 bot author filter');

  await test('no filter set → every message passes (fail-open)', () => {
    setApiBotUserId(null);
    assert.equal(getApiBotUserId(), null);
    assert.equal(isFromApiBot(msg('anyone')), true);
    const all = [msg('a'), msg('b')];
    assert.deepEqual(filterByApiBot(all), all);
  });

  await test('filter set → only the API bot\'s messages survive', () => {
    setApiBotUserId('111');
    assert.equal(isFromApiBot(msg('111')), true);
    assert.equal(isFromApiBot(msg('222')), false);
    const kept = filterByApiBot([msg('111', 'mine'), msg('222', 'other slot')]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].content, 'mine');
  });

  await test('filter drops a SIBLING slot bot posting the same content', () => {
    setApiBotUserId('111');
    const kept = filterByApiBot([msg('222', 'Raid Night'), msg('111', 'Raid Night')]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].authorId, '111');
  });

  await test('setApiBotUserId(null) clears a previously set filter', () => {
    setApiBotUserId('111');
    setApiBotUserId(null);
    assert.equal(isFromApiBot(msg('999')), true);
  });

  await test('SMOKE_BOT_USER_ID overrides the API lookup', async () => {
    const api = { get: () => Promise.reject(new Error('should not be called')) };
    const id = await resolveApiBotUserId(api, { SMOKE_BOT_USER_ID: '777' });
    assert.equal(id, '777');
  });

  await test('resolves botUserId from the bot status endpoint', async () => {
    let path = '';
    const api = {
      get: (p: string) => {
        path = p;
        return Promise.resolve({ connected: true, botUserId: '888' });
      },
    };
    const id = await resolveApiBotUserId(api, {});
    assert.equal(id, '888');
    assert.match(path, /discord-bot/);
  });

  await test('returns null when the API omits botUserId (old build)', async () => {
    const api = { get: () => Promise.resolve({ connected: true }) };
    assert.equal(await resolveApiBotUserId(api, {}), null);
  });

  await test('returns null (never throws) when the status call fails', async () => {
    const api = { get: () => Promise.reject(new Error('500')) };
    assert.equal(await resolveApiBotUserId(api, {}), null);
  });

  await test('waitForMessage shares the readLastMessages filter (review M6)', () => {
    // waitForMessage is event-driven, so it never touched readLastMessages'
    // filter — a sibling slot's bot posting into the same channel could still
    // resolve a wait. The predicate gate is the same `isFromApiBot` call, so
    // pinning it here pins both paths.
    setApiBotUserId('111');
    assert.equal(shouldAcceptMessage(msg('111')), true);
    assert.equal(shouldAcceptMessage(msg('222')), false);
    setApiBotUserId(null);
    assert.equal(shouldAcceptMessage(msg('222')), true, 'fail-open unchanged');
  });

  setApiBotUserId(null);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
