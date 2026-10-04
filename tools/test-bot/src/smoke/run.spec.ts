/**
 * Unit tests for the runner's pure helpers: isTimeoutError (ROK-952) and
 * partitionTests, the parallel/sequential split (TDB:966).
 *
 * run.ts itself is never imported here: it calls main() at module scope.
 *
 * Run: npx tsx src/smoke/run.spec.ts
 */
import assert from 'node:assert/strict';
import { SmokeAssertionError } from './assert.js';
import { isTimeoutError } from './retry.js';
import { partitionTests } from './test-partition.js';
import type { SmokeTest } from './types.js';

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

console.log('run.spec.ts — isTimeoutError\n');

// --- isTimeoutError tests ---

test('returns true for pollForEmbed timeout error', () => {
  const err = new Error('pollForEmbed timed out after 60000ms');
  assert.equal(isTimeoutError(err), true);
});

test('returns true for awaitDrained timeout error', () => {
  const err = new Error('awaitDrained timed out after 30000ms');
  assert.equal(isTimeoutError(err), true);
});

test('returns false for SmokeAssertionError without timeout text', () => {
  const err = new SmokeAssertionError('Expected embed title matching /foo/');
  assert.equal(isTimeoutError(err), false);
});

test('returns false for SmokeAssertionError even when message contains "timed out"', () => {
  // A SmokeAssertionError is a real test failure, not a retriable timeout.
  // isTimeoutError must check the error type, not just the message text.
  const err = new SmokeAssertionError('Embed assertion timed out waiting for update');
  assert.equal(isTimeoutError(err), false);
});

test('returns false for generic errors without "timed out"', () => {
  const err = new Error('some other error');
  assert.equal(isTimeoutError(err), false);
});

test('returns false for non-Error values', () => {
  assert.equal(isTimeoutError('string error' as unknown), false);
});

test('returns true when error message contains "timed out" anywhere', () => {
  const err = new Error('Operation XYZ timed out waiting for response');
  assert.equal(isTimeoutError(err), true);
});

// --- partitionTests tests ---

console.log('\nrun.spec.ts — partitionTests\n');

function smoke(
  name: string,
  category: SmokeTest['category'],
  serial?: true,
): SmokeTest {
  const t: SmokeTest = { name, category, run: async () => undefined };
  return serial ? { ...t, serial } : t;
}

const names = (tests: SmokeTest[]) => tests.map((t) => t.name);

test('voice and cdp-command tests go to sequential', () => {
  const { parallel, sequential } = partitionTests([
    smoke('voice-a', 'voice'),
    smoke('cdp-a', 'cdp-command'),
  ]);
  assert.deepEqual(names(sequential), ['voice-a', 'cdp-a']);
  assert.deepEqual(names(parallel), []);
});

test('serial:true dm tests go to sequential', () => {
  const { parallel, sequential } = partitionTests([
    smoke('ai-chat-a', 'dm', true),
    smoke('ai-chat-b', 'dm', true),
  ]);
  assert.deepEqual(
    names(sequential),
    ['ai-chat-a', 'ai-chat-b'],
    'a serial-tagged dm test must not join the parallel pool',
  );
  assert.deepEqual(names(parallel), []);
});

test('untagged dm and embed tests go to parallel', () => {
  const { parallel, sequential } = partitionTests([
    smoke('dm-a', 'dm'),
    smoke('embed-a', 'embed'),
  ]);
  assert.deepEqual(names(parallel), ['dm-a', 'embed-a']);
  assert.deepEqual(names(sequential), []);
});

test('input order is preserved in both lists', () => {
  const { parallel, sequential } = partitionTests([
    smoke('p1', 'embed'),
    smoke('s1', 'dm', true),
    smoke('p2', 'dm'),
    smoke('s2', 'voice'),
    smoke('p3', 'flow'),
    smoke('s3', 'dm', true),
    smoke('s4', 'cdp-command'),
  ]);
  assert.deepEqual(names(parallel), ['p1', 'p2', 'p3']);
  assert.deepEqual(names(sequential), ['s1', 's2', 's3', 's4']);
});

test('an empty input gives empty lists', () => {
  assert.deepEqual(partitionTests([]), { parallel: [], sequential: [] });
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
