#!/usr/bin/env npx tsx
/**
 * firstFreshMatch() — the match rule behind `pollForEmbed`'s `excludeIds`.
 * Channel reads are oldest-first and the first match wins, so a predicate
 * that keys only on a seeded id or href settles on a PRIOR run's card with
 * the same href (TDB:571 / TDB:1459). Ids snapshotted before the mutation
 * under test must never match; the fresh card after them must.
 *
 * Pure — messages are literals; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/polling-fence.spec.ts
 */
import assert from 'node:assert/strict';

import { firstFreshMatch } from '../helpers/polling.js';
import type { SimpleMessage } from '../helpers/messages.js';

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

test('without a fence the oldest match wins (the ghost this guards against)', () => {
  assert.equal(firstFreshMatch([GHOST, NOISE, FRESH], linksHref)?.id, 'ghost');
});

test('skips an excluded older match and returns the fresh one', () => {
  const match = firstFreshMatch([GHOST, NOISE, FRESH], linksHref, new Set(['ghost']));
  assert.equal(match?.id, 'fresh', `expected the fresh card, got ${match?.id ?? 'no match'}`);
});

test('returns undefined when only excluded messages match', () => {
  const match = firstFreshMatch([GHOST, NOISE], linksHref, new Set(['ghost', 'noise']));
  assert.equal(match, undefined, `expected no match, got ${match?.id}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
