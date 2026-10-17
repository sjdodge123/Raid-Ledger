#!/usr/bin/env npx tsx
/**
 * withChannelDump() — the ROK-1390 quick-play smoke failed as a bare
 * "pollForEmbed timed out ... on channel X", which reads the same whether no
 * embed was posted or an embed the predicate rejected was. On a timeout the
 * failure must now carry each channel's last messages (author tag, embed
 * title / author / footer, content head); any other error passes unchanged.
 *
 * Pure — the channel reader is a stub; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/channel-dump.spec.ts
 */
import assert from 'node:assert/strict';

import { DUMP_COUNT, withChannelDump, type DumpReader } from './channel-dump.js';
import type { SimpleEmbed, SimpleMessage } from '../helpers/messages.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(err as Error).message}`);
  }
}

function embed(over: Partial<SimpleEmbed>): SimpleEmbed {
  return {
    title: null, author: null, description: null, color: null,
    fields: [], footer: null, thumbnail: null, timestamp: null, ...over,
  };
}

function msg(id: string, content: string, embeds: SimpleEmbed[] = []): SimpleMessage {
  return {
    id, authorId: 'bot-1', authorTag: 'RL Bot#0001', content, embeds,
    components: [], timestamp: new Date(0), editedAt: null,
  };
}

const TIMEOUT = 'pollForEmbed timed out after 60000ms on channel ch-text';
const timesOut = () => Promise.reject(new Error(TIMEOUT));
const SERIES = { label: 'series text', channelId: 'ch-text' };
const DEFAULT = { label: 'default notification', channelId: 'ch-default' };

async function failureOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected withChannelDump to throw');
}

console.log('\n=== withChannelDump ===');

await test('a timeout names each channel and its messages: author tag, embed title/author/footer, content head', async () => {
  const live = embed({ title: 'Valheim', author: 'LIVE NOW', footer: 'Series: Weekly' });
  const channels: Record<string, SimpleMessage[]> = {
    'ch-text': [msg('m1', 'x'.repeat(120), [live])],
    'ch-default': [msg('m2', 'plain text, no card')],
  };
  const read: DumpReader = async (id) => channels[id] ?? [];
  const text = await failureOf(
    withChannelDump(timesOut, 'Expected quick-play embed', [SERIES, DEFAULT], read),
  );
  assert.equal(
    text,
    [
      `Expected quick-play embed: ${TIMEOUT}`,
      '  series text (channel ch-text), last 1, oldest first:',
      `    RL Bot#0001 | embed title="Valheim" author="LIVE NOW" footer="Series: Weekly" | content="${'x'.repeat(80)}"`,
      '  default notification (channel ch-default), last 1, oldest first:',
      '    RL Bot#0001 | no embed | content="plain text, no card"',
    ].join('\n'),
  );
});

await test(`each channel is read for its last ${DUMP_COUNT} messages and dumped once when both targets share it`, async () => {
  const counts: number[] = [];
  const many = Array.from({ length: DUMP_COUNT + 3 }, (_, i) => msg(`m${i}`, `n${i}`));
  const read: DumpReader = async (_id, count) => (counts.push(count), many);
  const text = await failureOf(
    withChannelDump(timesOut, 'ctx', [SERIES, { ...DEFAULT, channelId: 'ch-text' }], read),
  );
  assert.deepEqual(counts, [DUMP_COUNT]);
  assert.match(text, /series text \+ default notification \(channel ch-text\), last 10, oldest first:/);
  assert.match(text, /content="n3"/);
  assert.doesNotMatch(text, /content="n2"/);
});

await test('a failed read is reported in the dump and the timeout text survives', async () => {
  const read: DumpReader = async (id) => {
    if (id === 'ch-text') throw new Error('Missing Access');
    return [];
  };
  const text = await failureOf(withChannelDump(timesOut, 'ctx', [SERIES, DEFAULT], read));
  assert.match(text, new RegExp(`^ctx: ${TIMEOUT}`));
  assert.match(text, /series text \(channel ch-text\): read failed \(Missing Access\)/);
  assert.match(text, /default notification \(channel ch-default\): no messages/);
});

await test('a non-timeout error propagates unchanged and nothing is read', async () => {
  let reads = 0;
  const read: DumpReader = async () => (reads++, []);
  const boom = new Error('render rule: unrendered token <@123>');
  const text = await failureOf(withChannelDump(() => Promise.reject(boom), 'ctx', [SERIES], read));
  assert.equal(text, boom.message);
  assert.equal(reads, 0);
});

await test('a poll that matches returns its result without reading', async () => {
  let reads = 0;
  const read: DumpReader = async () => (reads++, []);
  const found = msg('m9', 'hit');
  assert.equal(await withChannelDump(async () => found, 'ctx', [SERIES], read), found);
  assert.equal(reads, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
