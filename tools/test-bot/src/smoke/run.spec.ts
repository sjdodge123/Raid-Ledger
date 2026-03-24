#!/usr/bin/env npx tsx
/**
 * TDD failing tests for ROK-952: retry logic in smoke test runner.
 *
 * Tests the NEW `isTimeoutError` function that will be exported from run.ts.
 * These tests MUST fail until the dev agent implements the function.
 *
 * Run: npx tsx src/smoke/run.spec.ts
 */
import assert from 'node:assert/strict';
import { SmokeAssertionError } from './assert.js';

// This import will fail until the dev agent exports isTimeoutError from run.ts
import { isTimeoutError } from './run.js';

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

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
