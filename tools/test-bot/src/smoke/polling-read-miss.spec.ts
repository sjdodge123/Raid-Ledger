#!/usr/bin/env npx tsx
/**
 * readOrMiss() — one poll tick's channel read for pollForEmbed and the
 * waitForEmbedUpdate fallback. A Discord response truncated in transit makes
 * discord.js throw a bare SyntaxError naming no channel (~1 in 25 smoke runs,
 * 'Tentative signup reflected in embed'). That tick must count as a miss —
 * an empty read, logged with the channel id — so the next tick polls again.
 * Any other read error (e.g. Missing Access) must still propagate.
 *
 * Pure — the channel reader is a stub; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/polling-read-miss.spec.ts
 */
import assert from 'node:assert/strict';

import { readOrMiss } from '../helpers/polling.js';
import type { SimpleMessage } from '../helpers/messages.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${msg}`);
  }
}

/** Capture console.warn for the duration of `fn`. */
async function captureWarn(fn: () => Promise<void>): Promise<string[]> {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

const CHANNEL = '1234567890';
const MESSAGE = { id: 'm1', editedAt: null } as SimpleMessage;

await test('returns the read when the channel parses', async () => {
  const result = await readOrMiss(CHANNEL, 100, 'pollForEmbed', async () => [MESSAGE]);
  assert.deepEqual(result, [MESSAGE]);
});

await test('a truncated Discord body counts as a miss and names the channel', async () => {
  const truncated = async (): Promise<SimpleMessage[]> => {
    throw new SyntaxError('Unterminated string in JSON at position 139778');
  };
  let result: unknown;
  const warnings = await captureWarn(async () => {
    result = await readOrMiss(CHANNEL, 100, 'pollForEmbed', truncated).catch((e: unknown) => e);
  });
  assert.deepEqual(result, [], `a SyntaxError must be an empty read (a miss), got ${String(result)}`);
  assert.equal(warnings.length, 1, `expected 1 warning, got ${warnings.length}`);
  assert.match(warnings[0], /\[pollForEmbed\] channel 1234567890: unparseable Discord response \(Unterminated string/);
});

await test('any other read error still propagates', async () => {
  const denied = new Error('Missing Access');
  const result = await readOrMiss(CHANNEL, 100, 'waitForEmbedUpdate', async () => {
    throw denied;
  }).then(
    () => new Error('readOrMiss resolved; expected Missing Access to propagate'),
    (e: unknown) => e,
  );
  assert.equal(result, denied, `expected the original error, got ${String(result)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
