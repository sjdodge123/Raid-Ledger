#!/usr/bin/env npx tsx
/**
 * The run's shared hub forum (`tests/hub-forum-shared.ts`): its channel name,
 * and which leftover forums from an earlier, crashed run the sweep may
 * delete. The guild is shared by concurrent pool runs, so the filter must
 * FAIL CLOSED: a live run's forum (younger than the max run age), another
 * smoke's forum (`rl-smoke-forum-in-…`), or any other name never qualifies.
 *
 * Run: npx tsx src/smoke/shared-forum-name.spec.ts
 */
import assert from 'node:assert/strict';

import {
  SHARED_FORUM_MAX_AGE_MS,
  isStaleSharedForum,
  sharedForumName,
} from './shared-forum-name.js';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n  ${String(err)}`);
  }
}

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

test('name follows the rl-smoke-forum-<base36 ms> convention', () => {
  assert.equal(sharedForumName(NOW), `rl-smoke-forum-${NOW.toString(36)}`);
});

test('a forum older than the max run age is stale', () => {
  assert.equal(isStaleSharedForum(sharedForumName(NOW - SHARED_FORUM_MAX_AGE_MS - 1), NOW), true);
});

test('a live run forum (younger than the max age) is never stale', () => {
  assert.equal(isStaleSharedForum(sharedForumName(NOW - 60_000), NOW), false);
  assert.equal(isStaleSharedForum(sharedForumName(NOW - SHARED_FORUM_MAX_AGE_MS), NOW), false);
});

test('a forum from the future (clock skew) is not stale', () => {
  assert.equal(isStaleSharedForum(sharedForumName(NOW + 60_000), NOW), false);
});

test('other names never qualify', () => {
  const old = (NOW - SHARED_FORUM_MAX_AGE_MS * 4).toString(36);
  for (const name of [`rl-smoke-forum-in-${old}`, `ci-forum-${old}`, `rl-smoke-forum-${old}-x`, 'rl-smoke-forum-', `rl-smoke-forum-${old.toUpperCase()}`]) {
    assert.equal(isStaleSharedForum(name, NOW), false, name);
  }
});

console.log(`shared-forum-name: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
