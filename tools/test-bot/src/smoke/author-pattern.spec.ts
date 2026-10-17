#!/usr/bin/env npx tsx
/**
 * ROK-1460 fix 11 — the IMMINENT author-line pattern used by the chrome smoke
 * test must pin the REAL signup count.
 *
 * The fleet run failed with
 * `Expected author to match /STARTS IN \d+ MIN · 0 of 10/, got
 * "◌ STARTS IN 60 MIN · 1 of 10"` — the creator is auto-signed-up, so `0 of`
 * was simply wrong. The fix reads the count from the API; loosening to
 * `\d+ of` would have made the assertion vacuous, so these tests prove the
 * pattern still discriminates a wrong count.
 *
 * Run: npx tsx src/smoke/author-pattern.spec.ts
 */
import assert from 'node:assert/strict';

import { imminentAuthorPattern } from './assert.js';

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

/** The exact author line the fleet run observed. */
const OBSERVED = '◌ STARTS IN 60 MIN · 1 of 10';

test('matches the author line the fleet run actually produced', () => {
  assert.equal(imminentAuthorPattern(1, 10).test(OBSERVED), true);
});

test('rejects the wrong count that made the fleet run fail', () => {
  assert.equal(imminentAuthorPattern(0, 10).test(OBSERVED), false);
  assert.equal(imminentAuthorPattern(2, 10).test(OBSERVED), false);
});

test('rejects a wrong max', () => {
  assert.equal(imminentAuthorPattern(1, 8).test(OBSERVED), false);
});

test('is not satisfied by a bare digit elsewhere in the line', () => {
  assert.equal(imminentAuthorPattern(1, 10).test('◌ STARTS IN 1 MIN'), false);
  assert.equal(
    imminentAuthorPattern(1, 10).test('▸ LIVE · started 1 min ago'),
    false,
  );
});

test('accepts any elapsed-minutes value', () => {
  assert.equal(
    imminentAuthorPattern(3, 10).test('◌ STARTS IN 7 MIN · 3 of 10'),
    true,
  );
});

test('does not match a two-digit count when one digit is expected', () => {
  assert.equal(
    imminentAuthorPattern(1, 10).test('◌ STARTS IN 60 MIN · 10 of 10'),
    false,
  );
});

// --- Summary ---

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
