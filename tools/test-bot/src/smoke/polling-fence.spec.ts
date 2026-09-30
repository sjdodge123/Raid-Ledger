#!/usr/bin/env npx tsx
/**
 * firstFreshMatch() — the match rule behind `pollForEmbed`'s `excludeIds`.
 * Channel reads are oldest-first and the first match wins, so a predicate
 * that keys only on a seeded id or href settles on a PRIOR run's card with
 * the same href (TDB:571 / TDB:1459). Ids snapshotted before the mutation
 * under test must never match; the fresh card after them must.
 *
 * snapshotMessageIds() — the fence itself never fails OPEN: a truncated
 * Discord read is re-read, never returned as an empty fence that would let a
 * prior run's card match.
 *
 * Pure — messages are literals; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/polling-fence.spec.ts
 */
import assert from 'node:assert/strict';

import { firstFreshMatch, snapshotMessageIds } from '../helpers/polling.js';
import type { SimpleMessage } from '../helpers/messages.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

const HREF = '/community-lineup/1/schedule/1';

function card(id: string, description: string): SimpleMessage {
  return { id, editedAt: null, embeds: [{ description }] } as SimpleMessage;
}

const linksHref = (m: SimpleMessage) =>
  m.embeds.some((e) => (e.description ?? '').includes(HREF));

/** Oldest-first, as `readLastMessages` returns them: ghost, noise, fresh. */
const GHOST = card('ghost', `prior run [Vote now](${HREF})`);
const NOISE = card('noise', 'an unrelated card');
const FRESH = card('fresh', `this run [Vote now](${HREF})`);

await test('without a fence the oldest match wins (the ghost this guards against)', () => {
  assert.equal(firstFreshMatch([GHOST, NOISE, FRESH], linksHref)?.id, 'ghost');
});

await test('skips an excluded older match and returns the fresh one', () => {
  const match = firstFreshMatch([GHOST, NOISE, FRESH], linksHref, new Set(['ghost']));
  assert.equal(match?.id, 'fresh', `expected the fresh card, got ${match?.id ?? 'no match'}`);
});

await test('returns undefined when only excluded messages match', () => {
  const match = firstFreshMatch([GHOST, NOISE], linksHref, new Set(['ghost', 'noise']));
  assert.equal(match, undefined, `expected no match, got ${match?.id}`);
});

const truncated = () => new SyntaxError('Unterminated string in JSON at position 139778');

/** A channel reader that throws a truncation `failures` times, then serves `msgs`. */
function flakyReader(failures: number, msgs: SimpleMessage[]) {
  let calls = 0;
  const read = async (): Promise<SimpleMessage[]> => {
    calls++;
    if (calls <= failures) throw truncated();
    return msgs;
  };
  return { read, calls: () => calls };
}

await test('snapshotMessageIds re-reads a truncated response instead of fencing nothing', async () => {
  const reader = flakyReader(1, [GHOST, NOISE]);
  const ids = await snapshotMessageIds('chan', 100, reader.read);
  assert.deepEqual([...ids], ['ghost', 'noise'], `expected the re-read's ids, got [${[...ids]}]`);
  assert.equal(reader.calls(), 2, `expected 2 reads, got ${reader.calls()}`);
});

await test('snapshotMessageIds throws after repeated truncation, never an empty fence', async () => {
  const reader = flakyReader(99, [GHOST]);
  const outcome = await snapshotMessageIds('chan', 100, reader.read).then(
    (ids) => `resolved to a fence of ${ids.size} id(s)`,
    (err: unknown) => err,
  );
  assert.ok(outcome instanceof SyntaxError, `expected the SyntaxError to propagate, got ${String(outcome)}`);
  assert.equal(reader.calls(), 3, `expected 3 reads, got ${reader.calls()}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
