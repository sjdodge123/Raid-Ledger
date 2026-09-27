/**
 * ROK-1693 — node:test spec for the migration merge-order guard.
 * Synthetic journals reproduce the exact prod skip: 0176_lfg_invites merged
 * after 0177 with an older `when`, so Drizzle skipped it everywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUMP_MS,
  findMergeOrderViolations,
  formatReport,
  restampAfterBase,
} from './check-migration-merge-order.mjs';

const entry = (idx, name, when) => ({ idx, tag: `${String(idx).padStart(4, '0')}_${name}`, when });

// main when 0176 merged: 0175 then 0177 (0177 already applied in prod).
const BASE = [entry(175, 'discord_thread_messages', 1788656863825), entry(177, 'thread_message_reactions', 1788777821097)];
const BASE_MAX = BASE[1].when;

test('the 0176 shape — inserted mid-journal with an older when — fails and is not auto-fixable', () => {
  const head = [BASE[0], entry(176, 'lfg_invites', 1788754699835), BASE[1]];
  const violations = findMergeOrderViolations(BASE, head);
  assert.deepEqual(
    violations.map((v) => [v.tag, v.stale, v.fixable]),
    [['0176_lfg_invites', true, false]],
  );
  assert.match(formatReport(violations, 'origin/main'), /Renumber it/);
});

test('a new tail entry stamped older than the base max fails and points at fix-migration-order.sh', () => {
  const head = [...BASE, entry(178, 'late_branch', BASE_MAX - 1)];
  const violations = findMergeOrderViolations(BASE, head);
  assert.deepEqual(
    violations.map((v) => [v.tag, v.stale, v.fixable]),
    [['0178_late_branch', true, true]],
  );
  assert.match(formatReport(violations, 'origin/main'), /\.\/scripts\/fix-migration-order\.sh/);
});

test('a new entry stamped EQUAL to the base max fails (Drizzle compares with <)', () => {
  const head = [...BASE, entry(178, 'same_ms', BASE_MAX)];
  assert.equal(findMergeOrderViolations(BASE, head).length, 1);
});

test('a correctly stamped new entry passes', () => {
  const head = [...BASE, entry(178, 'good', BASE_MAX + 1)];
  assert.deepEqual(findMergeOrderViolations(BASE, head), []);
});

test('an unchanged journal and an empty base both pass', () => {
  assert.deepEqual(findMergeOrderViolations(BASE, BASE), []);
  assert.deepEqual(findMergeOrderViolations([], [entry(0, 'init', 1)]), []);
});

test('restampAfterBase re-stamps stale tail entries past the base max, in order, never touching base entries', () => {
  const head = [...BASE, entry(178, 'a', BASE_MAX - 5), entry(179, 'b', BASE_MAX - 1)];
  const { entries, changed, unfixable } = restampAfterBase(BASE, head);
  assert.deepEqual(unfixable, []);
  assert.deepEqual(changed, ['0178_a', '0179_b']);
  assert.deepEqual(entries.slice(0, 2), BASE);
  assert.equal(entries[2].when, BASE_MAX + BUMP_MS);
  assert.equal(entries[3].when, BASE_MAX + 2 * BUMP_MS);
  assert.deepEqual(findMergeOrderViolations(BASE, entries), []);
});

test('restampAfterBase refuses the mid-journal shape and returns the journal untouched', () => {
  const head = [BASE[0], entry(176, 'lfg_invites', 1788754699835), BASE[1]];
  const { entries, changed, unfixable } = restampAfterBase(BASE, head);
  assert.equal(entries, head);
  assert.deepEqual(changed, []);
  assert.deepEqual(unfixable.map((v) => v.tag), ['0176_lfg_invites']);
});
