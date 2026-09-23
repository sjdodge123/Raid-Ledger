#!/usr/bin/env npx tsx
/**
 * ROK-1612 AC1 — `pickBoardIntro` names the forum's PINNED intro post, not the
 * first post that happens to share its title.
 *
 * Fixture mirrors the shared CI guild's board forum as read on 2026-09-23:
 * five "How this board works" posts, one per bot, only one of them pinned,
 * listed newest first — so a title-only pick lands on another env's post.
 *
 * Run: npx tsx src/smoke/lfg-board-intro-pick.spec.ts
 */
import assert from 'node:assert/strict';

import { pickBoardIntro } from './lfg-board-intro-pick.js';

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

const TITLE = 'How this board works';
const intro = (id: string, pinned = false) => ({ id, name: TITLE, pinned });

const SHARED_FORUM = [
  intro('1551157129061339177'),
  intro('1550778745588027435'),
  intro('1549111812753203271'),
  intro('1547346943645061250'),
  intro('1547341418857767012', true),
];

test('picks the pinned intro among same-titled posts from other bots', () => {
  assert.equal(
    pickBoardIntro(SHARED_FORUM, TITLE)?.id,
    '1547341418857767012',
    'the pinned intro must be picked, not the first title match',
  );
});

test('no pinned intro → null, so the poll keeps waiting', () => {
  assert.equal(pickBoardIntro(SHARED_FORUM.slice(0, 4), TITLE), null);
});

test('a pinned post with another title is not the intro', () => {
  const posts = [{ id: '9', name: 'Raid tonight', pinned: true }, intro('1')];
  assert.equal(pickBoardIntro(posts, TITLE), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
