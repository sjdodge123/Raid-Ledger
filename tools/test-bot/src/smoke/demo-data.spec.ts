#!/usr/bin/env npx tsx
/**
 * demo-data — the smoke operator must never be handed out as a roster user.
 *
 * Run: npx tsx src/smoke/demo-data.spec.ts
 */
import assert from 'node:assert/strict';

import { buildDemoData, pickOperatorUser } from './demo-data.js';

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

const USERS = [1, 2, 3, 4, 5].map((id) => ({ id, username: `user${id}` }));
const TEST_USER = 1;
const DM_RECIPIENT = 2;

console.log('demo-data');

test('pickOperatorUser skips the taken test user and DM recipient', () => {
  assert.equal(pickOperatorUser(USERS, [TEST_USER, DM_RECIPIENT])?.id, 3);
});

test('pickOperatorUser returns undefined when every user is taken', () => {
  assert.equal(pickOperatorUser(USERS, [1, 2, 3, 4, 5]), undefined);
});

test('demoUserIds excludes the operator (it was demoUserIds[0] before the fix)', () => {
  const operator = pickOperatorUser(USERS, [TEST_USER, DM_RECIPIENT]);
  assert.ok(operator);
  const { demoUserIds } = buildDemoData(
    USERS,
    [TEST_USER, DM_RECIPIENT, operator.id],
    undefined,
  );
  assert.deepEqual(demoUserIds, [4, 5]);
  assert.ok(
    !demoUserIds.includes(operator.id),
    `operator ${operator.id} leaked into demoUserIds ${JSON.stringify(demoUserIds)}`,
  );
});

test('games carries the MMO game only when users exist', () => {
  assert.deepEqual(buildDemoData(USERS, [], 7).games, [{ id: 7, name: 'Game 7' }]);
  assert.deepEqual(buildDemoData([], [], 7).games, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
