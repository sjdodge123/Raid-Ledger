#!/usr/bin/env npx tsx
/**
 * ROK-1612 AC1 — `pickBoardIntro` names THIS env's bot's intro post (pinned
 * preferred, never required), not the first post that shares its title.
 *
 * Fixture mirrors the shared CI guild's board forum as read on 2026-09-23:
 * five "How this board works" posts, one per bot, only one of them pinned,
 * listed newest first — so a title-only pick lands on another env's post.
 * ROK-1658 renamed the intro, so the pick takes the current AND legacy titles.
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

/** ROK-1658 — the pre-rename title every intro in the fixture still carries. */
const LEGACY = 'How this board works';
/** `INTRO_TITLE` after ROK-1658 (U+2795, U+00B7). */
const CURRENT = '➕ Post an LFG here · How this board works';
/** `INTRO_TITLES` — what every caller passes. */
const TITLE = [CURRENT, LEGACY];
const THIS_BOT = '1400000000000000001';
const OTHER_BOT = '1400000000000000002';
const intro = (
  id: string,
  pinned = false,
  ownerId: string | null = THIS_BOT,
  name = LEGACY,
) => ({ id, name, pinned, ownerId });

const SHARED_FORUM = [
  intro('1551157129061339177'),
  intro('1550778745588027435'),
  intro('1549111812753203271'),
  intro('1547346943645061250'),
  intro('1547341418857767012', true),
];

test('prefers the pinned intro among this bot\'s same-titled posts', () => {
  assert.equal(
    pickBoardIntro(SHARED_FORUM, TITLE, THIS_BOT)?.id,
    '1547341418857767012',
    'the pinned intro must be picked, not the first title match',
  );
});

// Discord refuses a second forum pin (30047); the product logs it and still
// puts the composer on its stored, unpinned intro. The pick must follow.
test('none of ours pinned → the oldest of ours (the product adopts oldest)', () => {
  assert.equal(
    pickBoardIntro(SHARED_FORUM.slice(0, 4), TITLE, THIS_BOT)?.id,
    '1547346943645061250',
  );
});

test('an active intro of ours beats an older archived one', () => {
  const posts = [
    { ...intro('1547346943645061250'), archived: true },
    intro('1551157129061339177'),
  ];
  assert.equal(
    pickBoardIntro(posts, TITLE, THIS_BOT)?.id,
    '1551157129061339177',
  );
});

test('a pinned post with another title is not the intro', () => {
  const posts = [
    { id: '9', name: 'Raid tonight', pinned: true, ownerId: THIS_BOT },
    intro('1'),
  ];
  assert.equal(pickBoardIntro(posts, TITLE, THIS_BOT)?.id, '1');
});

// The 2026-09-23 CI failure: a fleet env's bot holds the forum's one pin, and
// CI's bot's own intro is unpinned but carries the composer buttons.
test("another bot holds the pin → our unpinned intro is still picked", () => {
  const posts = [intro('8', true, OTHER_BOT), intro('9', false, THIS_BOT)];
  assert.equal(
    pickBoardIntro(posts, TITLE, THIS_BOT)?.id,
    '9',
    "this bot's unpinned intro must be picked, not another bot's pinned one",
  );
});

// Codex P2 — the shared forum's intros can ALL be other bots'; picking one
// would pass whether or not this env seeded its own.
test("only another bot's intros (pinned or not) → null", () => {
  const posts = [intro('7', false, OTHER_BOT), intro('8', true, OTHER_BOT)];
  assert.equal(
    pickBoardIntro(posts, TITLE, THIS_BOT),
    null,
    'an intro owned by another bot must not be picked',
  );
});

test("this env's bot's pinned intro is picked when a bot id is set", () => {
  const posts = [intro('8', true, OTHER_BOT), intro('9', true, THIS_BOT)];
  assert.equal(pickBoardIntro(posts, TITLE, THIS_BOT)?.id, '9');
});

test('no bot id → the pinned intro, whoever owns it', () => {
  const posts = [intro('7', false, OTHER_BOT), intro('8', true, OTHER_BOT)];
  assert.equal(pickBoardIntro(posts, TITLE, null)?.id, '8');
});

test('no bot id and nothing pinned → null, never a bare title match', () => {
  assert.equal(pickBoardIntro([intro('7', false, OTHER_BOT)], TITLE, null), null);
});

test('an archived-only intro of ours is not the live intro (Codex P2)', () => {
  const posts = [{ ...intro('1547346943645061250'), archived: true }];
  assert.equal(
    pickBoardIntro(posts, TITLE, THIS_BOT),
    null,
    'an archived intro must never be picked; the product adopts active posts only',
  );
});

// ROK-1658 — the forum holds the current title AND legacy ones at once.
test('an intro of ours under the CURRENT title is picked', () => {
  const posts = [intro('8', true, OTHER_BOT), intro('9', false, THIS_BOT, CURRENT)];
  assert.equal(pickBoardIntro(posts, TITLE, THIS_BOT)?.id, '9');
});

test('a legacy-titled intro of ours is still picked (adopted, then renamed)', () => {
  const posts = [intro('8', false, OTHER_BOT, CURRENT), intro('9', false, THIS_BOT, LEGACY)];
  assert.equal(
    pickBoardIntro(posts, TITLE, THIS_BOT)?.id,
    '9',
    "this bot's legacy-titled intro must be picked, not another bot's current-titled one",
  );
});

test('a title outside the list is not an intro, even ours and pinned', () => {
  const posts = [intro('9', true, THIS_BOT, 'How this board works (old)')];
  assert.equal(pickBoardIntro(posts, TITLE, THIS_BOT), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
