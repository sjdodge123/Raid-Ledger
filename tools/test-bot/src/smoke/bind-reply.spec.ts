#!/usr/bin/env npx tsx
/**
 * /bind reply checks used by the series dual-binding smoke tests.
 *
 * Regression: bindSeriesChannel discarded the slash-command reply, so a /bind
 * that refused (through editReply, never a throw) surfaced only as
 * "Expected a series-linked voice binding ... got []" with no hint why. The
 * refusal sentence must now be the failure message.
 *
 * Run: npx tsx src/smoke/bind-reply.spec.ts
 */
import assert from 'node:assert/strict';

import { assertBindSucceeded, isBindSuccess } from './bind-reply.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(err as Error).message}`);
  }
}

const LABEL = 'series g1 -> voice #v1';

/** Run assertBindSucceeded and return the thrown message, or null. */
function refusalOf(res: Parameters<typeof assertBindSucceeded>[0]): string | null {
  try {
    assertBindSucceeded(res, LABEL);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

test('a BINDING SAVED embed passes', () => {
  const res = {
    embeds: [{ author: { name: '⚙ BINDING SAVED' }, title: '#v1 → Voice' }],
  };
  assert.equal(isBindSuccess(res), true, 'success embed not recognised');
  assert.equal(refusalOf(res), null, 'success reply was treated as a refusal');
});

test('an EVENT BINDING SAVED embed passes', () => {
  const res = { embeds: [{ author: { name: '⚙ EVENT BINDING SAVED' } }] };
  assert.equal(refusalOf(res), null, 'event-bind success was treated as a refusal');
});

test('a plain-content refusal throws with that sentence', () => {
  assert.equal(
    refusalOf({ content: 'Event series not found.' }),
    `/bind ${LABEL} refused: Event series not found.`,
  );
});

test('a reject embed throws with its description', () => {
  const res = {
    embeds: [
      {
        author: { name: '⚙ BINDING REJECTED' },
        description: 'Game "X" is already bound to #other.',
      },
    ],
  };
  assert.equal(
    refusalOf(res),
    `/bind ${LABEL} refused: Game "X" is already bound to #other.`,
  );
});

test('an empty reply throws and shows the raw reply', () => {
  assert.equal(
    refusalOf({}),
    `/bind ${LABEL} refused: no reply text (raw reply: {})`,
  );
});

test('a title-only embed without the saved author is a refusal', () => {
  const res = { embeds: [{ title: 'Confirm multiple monitors?' }] };
  assert.equal(
    refusalOf(res),
    `/bind ${LABEL} refused: Confirm multiple monitors?`,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
