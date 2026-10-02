#!/usr/bin/env npx tsx
/**
 * isMilestoneCardFor — the private-lineup milestone smoke's negative check
 * must match ONLY a nomination-milestone card for its own lineup, never the
 * 🛑 ABORTED card a sibling test's archive posts with the same title.
 *
 * Pure — hand-built embeds; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/lineup-milestone-match.spec.ts
 */
import assert from 'node:assert/strict';

import type { SimpleEmbed } from '../helpers/messages.js';
import { isLeftoverLineup, isMilestoneCardFor } from './lineup-milestone-match.js';

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

function embed(over: Partial<SimpleEmbed>): SimpleEmbed {
  return {
    title: null,
    author: null,
    description: null,
    color: null,
    fields: [],
    footer: null,
    thumbnail: null,
    timestamp: null,
    ...over,
  };
}

const TITLE = 'Private MS-check 1727700000000';

console.log('\nisMilestoneCardFor\n');

/** Aborted card as buildAbortedEmbed shapes it (lineup-notification-aborted-embed.helpers.ts). */
function abortedCard(title: string): SimpleEmbed {
  return embed({
    title,
    author: '🛑 ABORTED',
    description: 'This lineup was aborted by **admin**.\n\nOpen lineup ↗',
    footer: 'Raid Ledger · Aborted',
  });
}

test('rejects the ABORTED card for the same lineup title', () => {
  // The pre-fix fixture title: its own "Milestone" made every card match.
  for (const title of ['Private Milestone 1727700000000', TITLE]) {
    assert.equal(
      isMilestoneCardFor(abortedCard(title), title),
      false,
      `an Aborted-footer card titled "${title}" must not count as a nomination milestone`,
    );
  }
});

test('accepts the nomination-milestone card for the lineup title', () => {
  const milestone = embed({
    title: TITLE,
    author: '🎯 MILESTONE',
    footer: 'Raid Ledger · Nomination Milestone',
  });
  assert.equal(isMilestoneCardFor(milestone, TITLE), true);
});

test('rejects a nomination-milestone card for another lineup', () => {
  const other = embed({
    title: 'Friday Raid Picks',
    footer: 'Raid Ledger · Nomination Milestone',
  });
  assert.equal(
    isMilestoneCardFor(other, TITLE),
    false,
    'a milestone card for a different lineup title must not match',
  );
});

console.log('\nisLeftoverLineup\n');

const PREFIXES = ['Private Smoke ', 'Private MS-check '];
const RUN_START = 1_727_700_000_000;

test('matches an own-prefix lineup stamped before this run', () => {
  assert.equal(isLeftoverLineup(`Private Smoke ${RUN_START - 1}`, PREFIXES, RUN_START), true);
});

test('never matches a lineup this run created', () => {
  assert.equal(
    isLeftoverLineup(`Private MS-check ${RUN_START + 5}`, PREFIXES, RUN_START),
    false,
    'a concurrent sibling test in this run must not be archived',
  );
});

test("never matches another file's lineup", () => {
  assert.equal(
    isLeftoverLineup(`Private Tie ${RUN_START - 1}`, PREFIXES, RUN_START),
    false,
    'lineups outside the own prefixes must not be archived',
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
