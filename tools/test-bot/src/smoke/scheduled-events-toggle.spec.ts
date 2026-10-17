#!/usr/bin/env npx tsx
/**
 * createToggleRefcount(): the scheduled-events toggle refcount (TDB:167).
 * Overlapping SE tests must share one enable, and only the LAST holder's
 * release may disable, or a finishing test turns Scheduled Event creation off
 * under a sibling that is still waiting for its event.
 *
 * Pure: enable/disable are injected fakes that record calls. Their completion
 * is driven by hand-resolved deferreds, so the overlap is deterministic. No
 * Discord connection, no API, no timers.
 *
 * Run: npx tsx src/smoke/scheduled-events-toggle.spec.ts
 */
import assert from 'node:assert/strict';

import { createToggleRefcount } from './scheduled-events-toggle.js';

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

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let every already-queued promise continuation run. */
const drain = () => new Promise<void>((r) => setImmediate(r));

/**
 * Fakes that log each call. A call parks on the next deferred queued via
 * `gate()`; with none queued it resolves at once.
 */
function fakeToggle() {
  const calls: string[] = [];
  const gates: Deferred[] = [];
  const op = (name: string) => async () => {
    calls.push(name);
    await gates.shift()?.promise;
  };
  const gate = () => {
    const d = deferred();
    gates.push(d);
    return d;
  };
  const ref = createToggleRefcount<null>({ enable: op('enable'), disable: op('disable') });
  return { calls, gate, ref };
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

await test('two overlapping holders share one enable; disable waits for the second release', async () => {
  const { calls, gate, ref } = fakeToggle();
  const enableGate = gate();
  let secondSettled = false;
  const first = ref.acquire(null);
  const second = ref.acquire(null).then(() => (secondSettled = true));
  await drain();
  assert.equal(secondSettled, false, 'second acquire resolved before the shared enable landed');
  enableGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['enable'], 'overlapping acquires must share ONE enable');
  await ref.release(null);
  assert.deepEqual(calls, ['enable'], 'first release disabled while a holder remained');
  await ref.release(null);
  assert.deepEqual(calls, ['enable', 'disable'], 'last release must disable');
});

await test('acquire, release, acquire gives enable, disable, enable', async () => {
  const { calls, ref } = fakeToggle();
  await ref.acquire(null);
  await ref.release(null);
  await ref.acquire(null);
  assert.deepEqual(calls, ['enable', 'disable', 'enable']);
  assert.equal(ref.holders(), 1);
});

await test('an acquire during an in-flight disable re-enables after it', async () => {
  const { calls, gate, ref } = fakeToggle();
  await ref.acquire(null);
  const disableGate = gate();
  const release = ref.release(null);
  const reacquire = ref.acquire(null);
  await drain();
  assert.deepEqual(calls, ['enable', 'disable'], 're-enable ran before the disable finished');
  disableGate.resolve();
  await Promise.all([release, reacquire]);
  assert.deepEqual(calls, ['enable', 'disable', 'enable'], 'the late acquire must re-enable');
  assert.equal(ref.holders(), 1);
});

await test('a stray release makes no disable call and does not drive the count negative', async () => {
  const { calls, ref } = fakeToggle();
  const warnings = await captureWarn(() => ref.release(null));
  assert.deepEqual(calls, [], 'a release with no holder must not call disable');
  assert.equal(warnings.length, 1, `expected one warning, got ${JSON.stringify(warnings)}`);
  assert.equal(ref.holders(), 0);
  await ref.acquire(null);
  assert.deepEqual(calls, ['enable'], 'the next acquire must still be the 0→1 enable');
});

await test('a rejected enable is not a hold; the next acquire enables again', async () => {
  const calls: string[] = [];
  let failNext = true;
  const ref = createToggleRefcount<null>({
    enable: async () => {
      calls.push('enable');
      if (failNext) {
        failNext = false;
        throw new Error('enable boom');
      }
    },
    disable: async () => void calls.push('disable'),
  });
  await assert.rejects(ref.acquire(null), /enable boom/);
  assert.equal(ref.holders(), 0, 'a rejected acquire must not keep a hold');
  await ref.acquire(null);
  assert.deepEqual(calls, ['enable', 'enable']);
});

console.log(`\nscheduled-events-toggle: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
