/**
 * ROK-1058 — failing TDD repro (Suite A of 2): BullMQ cross-file leak.
 *
 * This file MUST run before `bullmq-leak-b-assert.integration.spec.ts`.
 * Jest's default sequencer orders new files (no timing cache) alphabetically
 * by path; the `-a-` / `-b-` prefixes guarantee the order under
 * `--runInBand` + `maxWorkers: 1`. Both files live in `api/src/common/testing/`.
 *
 * Background (per `planning-artifacts/diagnosis-update-ROK-1058.md`):
 *   - `closeTestApp()` runs in a global `afterAll` so each spec file already
 *     gets a fresh NestJS app + DB pool (the `process[INSTANCE_KEY]`
 *     "singleton" comment in test-app.ts is stale — see diagnosis §1).
 *   - BullMQ in `queue.module.ts:12` connects to `REDIS_URL`
 *     (default `redis://localhost:6379`). The Redis mock at
 *     `test-app.ts` only overrides `REDIS_CLIENT`, NOT `BullModule`.
 *   - Therefore queue state lives in the shared `raid-ledger-redis`
 *     container — out of Node, and out of reach of `truncateAllTables`.
 *
 * Repro shape:
 *   Suite A (this file): enqueue a long-delayed job (1h delay so it never
 *     fires during the run) into `LINEUP_PHASE_QUEUE` with a deterministic
 *     `jobId`. Sanity-assert it landed in Redis. NO cleanup — the lack of
 *     cleanup is the bug we want Suite B to observe.
 *   Suite B: boots its own NestJS app (different Nest instance, different
 *     Queue connection), looks up the same `jobId`, asserts it is NOT
 *     present. On current main this FAILS — the job is still in Redis.
 *     Suite B's afterAll cleans the probe job so subsequent runs of THIS
 *     spec are idempotent.
 *
 * After the dev fix lands (BullMQ test-prefix + per-suite `obliterate` in
 * `truncateAllTables`), Suite B's queue snapshot is empty and the assertion
 * passes.
 *
 * Hard rule from the build template: tests only — no source-code edits, no
 * `queue.obliterate` here (that is the dev's fix, not the test's job).
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { getTestApp, type TestApp } from './test-app';
import { LINEUP_PHASE_QUEUE } from '../../lineups/queue/lineup-phase.constants';
import { ROK_1058_PROBE_JOB_ID } from './bullmq-leak.constants';

function describeSuiteA() {
  let testApp: TestApp;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await getTestApp();
    queue = testApp.app.get<Queue>(getQueueToken(LINEUP_PHASE_QUEUE));
    // Pre-clean any leftover probe from a previous failed run, so this
    // suite's "I just enqueued one" assertion is unambiguous.
    const stale = await queue.getJob(ROK_1058_PROBE_JOB_ID);
    if (stale) await stale.remove();
  });

  it('enqueues a delayed probe job that persists in shared Redis', async () => {
    // 1-hour delay — long enough to never fire during the test run, short
    // enough that any forgotten leftover ages out the queue eventually.
    const ONE_HOUR_MS = 60 * 60 * 1000;

    await queue.add(
      'phase-transition',
      { lineupId: -1, targetStatus: 'rok-1058-probe' },
      {
        jobId: ROK_1058_PROBE_JOB_ID,
        delay: ONE_HOUR_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    // Sanity: BullMQ accepted the job and it's sitting in Redis.
    const job = await queue.getJob(ROK_1058_PROBE_JOB_ID);
    expect(job).toBeDefined();
    expect(await job!.getState()).toBe('delayed');

    // NOTE: no afterEach / afterAll cleanup here. The whole point of the
    // repro is that the BullMQ teardown path does not exist on main, so
    // Suite B sees the leftover. Suite B owns final cleanup.
  });
}

describe('ROK-1058 BullMQ leak repro — Suite A (enqueue)', () =>
  describeSuiteA());
