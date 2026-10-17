/**
 * Shared constants for the ROK-1058 BullMQ leak repro pair (suites A + B).
 *
 * Lives in its own non-`.spec.ts` file so that `bullmq-leak-b-assert.integration.spec.ts`
 * can `import` the probe jobId without pulling Suite A's `describe()` into
 * Suite B's Jest context — a `*.spec.ts` import would register A's tests
 * twice and let Suite A's enqueue happen in Suite B's prefix, defeating
 * the cross-file isolation the repro is meant to verify.
 */

export const ROK_1058_PROBE_JOB_ID = 'rok-1058-bullmq-leak-probe';
