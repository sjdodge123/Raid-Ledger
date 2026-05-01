/**
 * ROK-1058 — failing TDD repro (Suite B of 2): BullMQ cross-file leak.
 *
 * Suite A enqueued a delayed job into `LINEUP_PHASE_QUEUE` with the
 * deterministic `jobId` `rok-1058-bullmq-leak-probe` and did NOT clean it
 * up. Suite B (this file) boots its OWN NestJS app — a fresh Queue
 * instance pointing at the same `raid-ledger-redis` container — and asserts
 * the job is gone.
 *
 * On current main: this assertion FAILS. The shared Redis still holds the
 * probe job (BullMQ state is process-external, untouched by
 * `truncateAllTables` and `app.close()`). That failure is the canonical
 * proof of the cross-file BullMQ leak named in
 * `planning-artifacts/diagnosis-update-ROK-1058.md` §3.
 *
 * After the dev fix (test-prefix `BullModule` config + per-suite
 * `queue.obliterate({force:true})` inside `truncateAllTables`), Suite B's
 * queue is empty for any probe job from a prior file → assertion passes.
 *
 * `afterAll` cleans up the probe job regardless of pass/fail so
 * back-to-back runs of just this 2-file repro are idempotent. The cleanup
 * happens AFTER the assertion, so it does not mask the leak on main.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { getTestApp, type TestApp } from './test-app';
import { LINEUP_PHASE_QUEUE } from '../../lineups/queue/lineup-phase.constants';
import { ROK_1058_PROBE_JOB_ID } from './bullmq-leak-a-enqueue.integration.spec';

function describeSuiteB() {
  let testApp: TestApp;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await getTestApp();
    queue = testApp.app.get<Queue>(getQueueToken(LINEUP_PHASE_QUEUE));
  });

  afterAll(async () => {
    // Idempotency for repeat runs: drop the probe even if the test failed.
    // This runs AFTER the it-body assertion below, so it never masks the
    // current-main failure.
    const leftover = await queue.getJob(ROK_1058_PROBE_JOB_ID);
    if (leftover) await leftover.remove();
  });

  it("does not see Suite A's probe job — queue must be isolated across spec files", async () => {
    const job = await queue.getJob(ROK_1058_PROBE_JOB_ID);

    // The canonical assertion: a BullMQ job enqueued by an earlier spec
    // file MUST NOT be visible in this file's freshly-booted Queue. On main
    // it is — same Redis, no test-prefix, no obliterate. After the fix it
    // is not — per-prefix Redis namespacing + per-suite obliterate.
    expect(job).toBeUndefined();
  });
}

describe('ROK-1058 BullMQ leak repro — Suite B (assert empty)', () =>
  describeSuiteB());
