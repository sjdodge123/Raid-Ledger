#!/usr/bin/env npx tsx
/**
 * ROK-1460 fix 12 — the CANCELLED smoke predicate.
 *
 * The fleet run timed out in `pollForEmbed` because the predicate still looked
 * for `CANCELLED` in `e.title`, while the new grammar puts `✕ CANCELLED` on the
 * chrome author line and strikes the title through. These tests replay both
 * shapes: the old predicate is shown to be unsatisfiable against a real
 * ROK-1460 cancelled card (the revert evidence), and the new one is shown to
 * still discriminate — it rejects the live card and other events' cards.
 *
 * Run: npx tsx src/smoke/cancelled-card.spec.ts
 */
import assert from 'node:assert/strict';

import { isCancelledCard } from './assert.js';

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

const TITLE = 'smoke-push-cancel-abc123';

/** A cancelled card as ROK-1460 renders it. */
const cancelled = { author: '✕ CANCELLED', title: `~~${TITLE}~~` };
/** The same event before cancellation. */
const live = { author: '◌ STARTS IN 60 MIN · 1 of 10', title: TITLE };
/** Another event's cancelled card, in the same channel. */
const otherCancelled = { author: '✕ CANCELLED', title: '~~smoke-other-xyz~~' };

/** The predicate as it stood before fix 12. */
const oldPredicate = (e: { title?: string | null }) =>
  !!e.title?.includes('CANCELLED') && !!e.title?.includes(TITLE);

test('the OLD title-only predicate cannot match a ROK-1460 cancelled card', () => {
  assert.equal(oldPredicate(cancelled), false);
});

test('the new predicate matches the cancelled card', () => {
  assert.equal(isCancelledCard(cancelled, TITLE), true);
});

test('it rejects the live card for the same event', () => {
  assert.equal(isCancelledCard(live, TITLE), false);
});

test('it rejects another event’s cancelled card', () => {
  assert.equal(isCancelledCard(otherCancelled, TITLE), false);
});

test('it requires the struck title, not just the author line', () => {
  assert.equal(
    isCancelledCard({ author: '✕ CANCELLED', title: TITLE }, TITLE),
    false,
  );
});

test('it requires the author line, not just a struck title', () => {
  assert.equal(
    isCancelledCard({ author: '■ ENDED · 2h', title: `~~${TITLE}~~` }, TITLE),
    false,
  );
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
