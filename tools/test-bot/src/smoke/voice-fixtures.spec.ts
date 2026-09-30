#!/usr/bin/env npx tsx
/**
 * voice-fixtures — the game lookup for game-voice-monitor bindings and the
 * classified-metrics poll behind the ROK-943 voice smoke.
 *
 * Pure — the API client is a stub; no Discord connection, no env.
 *
 * Run: npx tsx src/smoke/voice-fixtures.spec.ts
 */
import assert from 'node:assert/strict';

import {
  NO_MONITOR_GAME,
  pollClassifiedMetrics,
  resolveMonitorGameId,
  type ClassifiedMetricsShape,
} from './voice-fixtures.js';

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

/** A `get` stub that returns (or throws) each queued response in turn. */
function stubGet(responses: unknown[]) {
  const paths: string[] = [];
  const get = async <T>(path: string): Promise<T> => {
    paths.push(path);
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (next instanceof Error) throw next;
    return next as T;
  };
  return { api: { get }, paths };
}

const NOT_READY: ClassifiedMetricsShape = {
  attendanceSummary: { attended: 0 },
  voiceSummary: null,
};
const READY: ClassifiedMetricsShape = {
  attendanceSummary: { attended: 4 },
  voiceSummary: { full: 1 },
};

async function main() {
  console.log('\nresolveMonitorGameId\n');

  await test('uses the first demo game without calling the API', async () => {
    const { api, paths } = stubGet([{ data: [{ id: 99 }] }]);
    assert.equal(await resolveMonitorGameId({ games: [{ id: 7 }], api }), 7);
    assert.deepEqual(paths, [], 'expected no API call when ctx.games has a game');
  });

  await test('falls back to the first DB game when ctx.games is empty', async () => {
    const { api, paths } = stubGet([{ data: [{ id: 42 }] }]);
    assert.equal(
      await resolveMonitorGameId({ games: [], api }),
      42,
      'expected the DB game id, not undefined',
    );
    assert.deepEqual(paths, ['/admin/settings/games?limit=1']);
  });

  await test('names the missing precondition when there is no game at all', async () => {
    const { api } = stubGet([{ data: [] }]);
    await assert.rejects(resolveMonitorGameId({ games: [], api }), {
      message: NO_MONITOR_GAME,
    });
  });

  console.log('\npollClassifiedMetrics\n');

  await test('re-reads until classification is visible', async () => {
    const { api, paths } = stubGet([NOT_READY, NOT_READY, READY]);
    const m = await pollClassifiedMetrics({ api, config: { timeoutMs: 2000 } }, 5, 5);
    assert.deepEqual(m, READY, 'expected the classified read, not the first one');
    assert.equal(paths.length, 3, `expected 3 metrics reads, got ${paths.length}`);
    assert.equal(paths[0], '/events/5/metrics');
  });

  await test('returns the last read on timeout so assertions name the values', async () => {
    const { api } = stubGet([NOT_READY]);
    const m = await pollClassifiedMetrics({ api, config: { timeoutMs: 30 } }, 5, 5);
    assert.deepEqual(m, NOT_READY);
  });

  await test('propagates a failed metrics read', async () => {
    const { api } = stubGet([new Error('GET /events/5/metrics → 500')]);
    await assert.rejects(
      pollClassifiedMetrics({ api, config: { timeoutMs: 2000 } }, 5, 5),
      { message: 'GET /events/5/metrics → 500' },
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
