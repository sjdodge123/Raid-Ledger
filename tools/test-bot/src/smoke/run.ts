#!/usr/bin/env npx tsx
/**
 * Discord smoke test runner.
 *
 * Usage: npx tsx src/smoke/run.ts
 *
 * Connects the companion bot, auto-discovers channels/games from the API,
 * sets up fixtures, runs all smoke tests in parallel, then cleans up.
 */
import { disconnect } from '../client.js';
import { isTimeoutError } from './retry.js';
import { SMOKE } from './config.js';
import { teardownChannelPool } from './channel-pool.js';
import { setup } from './setup.js';
import type { SmokeTest, TestContext, TestResult } from './types.js';
import { channelEmbedTests } from './tests/channel-embeds.test.js';
import { dmNotificationTests } from './tests/dm-notifications.test.js';
import { voiceActivityTests } from './tests/voice-activity.test.js';
import { interactionFlowTests } from './tests/interaction-flows.test.js';
import { rosterCalculationTests } from './tests/roster-calculation.test.js';
import { pushContentTests } from './tests/push-content.test.js';
import { slashCommandTests } from './tests/slash-commands.test.js';
import { cdpSlashCommandTests } from './tests/cdp-slash-commands.test.js';
import { cdpSteamInterestTests } from './tests/cdp-steam-interest.test.js';
import { cdpSteamNominationTests } from './tests/cdp-steam-nomination.test.js';
import { scheduledEventCompletionTests } from './tests/scheduled-event-completion.test.js';
import { aiChatTests } from './tests/ai-chat.test.js';
import { lineupTitleTests } from './tests/lineup-title.test.js';

/** Build a TestResult from a test, status, and timing info. */
function buildResult(
  test: SmokeTest,
  status: 'PASS' | 'FAIL',
  start: number,
  opts?: { error?: string; retried?: boolean },
): TestResult {
  return {
    name: test.name,
    category: test.category,
    status,
    durationMs: Date.now() - start,
    error: opts?.error,
    retried: opts?.retried,
  };
}

async function runTest(
  test: SmokeTest,
  ctx: TestContext,
): Promise<TestResult> {
  const maxAttempts = 1 + ctx.config.retryCount;
  const start = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await test.run(ctx);
      return buildResult(test, 'PASS', start, { retried: attempt > 1 });
    } catch (err) {
      const isRetriable = isTimeoutError(err) && attempt < maxAttempts;
      if (isRetriable) {
        console.log(`  RETRY ${test.name} (attempt ${attempt + 1}/${maxAttempts})`);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      return buildResult(test, 'FAIL', start, {
        error: message,
        retried: attempt > 1,
      });
    }
  }

  return buildResult(test, 'FAIL', start, {
    error: 'Exhausted all retry attempts',
  });
}

function report(results: TestResult[]): number {
  console.log('\n=== Results ===\n');
  const groups = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = groups.get(r.category) ?? [];
    arr.push(r);
    groups.set(r.category, arr);
  }

  for (const [cat, tests] of groups) {
    console.log(`[${cat}]`);
    for (const t of tests) {
      const icon = t.status === 'PASS' ? 'PASS' : 'FAIL';
      const dur = `${(t.durationMs / 1000).toFixed(1)}s`;
      const suffix = t.retried ? ' (retried)' : '';
      console.log(`  ${icon}  ${t.name} (${dur})${suffix}`);
      if (t.error) console.log(`        ${t.error}`);
    }
    console.log();
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const retried = results.filter((r) => r.retried).length;
  const retriedSuffix = retried > 0 ? `, ${retried} retried` : '';
  console.log(`Total: ${pass} passed, ${fail} failed, ${results.length} total${retriedSuffix}`);
  return fail;
}

/** Run tasks with a concurrency limit (simple semaphore). */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Collect all test suites, optionally filtered by category. */
function collectTests(filterCat?: string): SmokeTest[] {
  return [
    ...channelEmbedTests,
    ...pushContentTests,
    ...rosterCalculationTests,
    ...dmNotificationTests,
    ...voiceActivityTests,
    ...interactionFlowTests,
    ...slashCommandTests,
    ...cdpSlashCommandTests,
    ...cdpSteamInterestTests,
    ...cdpSteamNominationTests,
    ...scheduledEventCompletionTests,
    ...aiChatTests,
    ...lineupTitleTests,
  ].filter((t) => !filterCat || t.category === filterCat);
}

/** Clean up resources and exit with the appropriate code. */
async function teardown(
  ctx: TestContext,
  failCount: number,
): Promise<never> {
  console.log('\n=== Teardown ===');
  await teardownChannelPool(ctx.api, ctx.channelPool ?? []);
  await disconnect();
  console.log('  Done.');
  process.exit(failCount > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  const ctx = await setup();
  const allTests = collectTests(process.env.SMOKE_CATEGORY);

  const sequentialCats = new Set(['voice', 'cdp-command']);
  const sequentialTests = allTests.filter((t) => sequentialCats.has(t.category));
  const parallelTests = allTests.filter((t) => !sequentialCats.has(t.category));

  const concurrency = SMOKE.concurrency;
  console.log(
    `=== Running ${parallelTests.length} tests (concurrency=${concurrency})` +
      `${sequentialTests.length ? `, ${sequentialTests.length} sequential tests (voice/cdp)` : ''} ===\n`,
  );

  const parallelResults = await runWithConcurrency(
    parallelTests,
    (t) => runTest(t, ctx),
    concurrency,
  );

  const sequentialResults: TestResult[] = [];
  for (const t of sequentialTests) {
    sequentialResults.push(await runTest(t, ctx));
  }

  const results = [...parallelResults, ...sequentialResults];
  const failCount = report(results);
  await teardown(ctx, failCount);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
