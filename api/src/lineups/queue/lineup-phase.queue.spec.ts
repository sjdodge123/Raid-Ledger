/**
 * `LineupPhaseQueueService.scheduleTransition` — two contracts, one file.
 *
 * ROK-1443: what jobId the transition lands under when the base id is still
 * ACTIVE (the building-deadline extension re-enqueues `voting` from inside
 * the `voting` job it is running in). BullMQ's `add` with an active job's id
 * is the silent duplicate branch (returns the existing job, stores nothing),
 * and an active job cannot be removed (locked). The replacement must land
 * under the `-r` id or the extended window never fires.
 *
 * ROK-1512: what happens when the enqueue itself FAILS. It used to be
 * swallowed into `logger.error`; BullMQ rejected a job id and the deadline
 * job silently ceased to exist for two ROK-1443 gate rounds. The contract
 * now: capture to Sentry (tagged with the lineup and target) AND rethrow.
 * Callers that must keep going opt in via `scheduleTransitionBestEffort`.
 */
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { LineupPhaseQueueService } from './lineup-phase.queue';
import {
  LINEUP_PHASE_RESCHEDULED_SUFFIX,
  LINEUP_PHASE_TRANSITION,
} from './lineup-phase.constants';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const BASE_ID = 'lineup-phase-7-voting';
const ALT_ID = `${BASE_ID}${LINEUP_PHASE_RESCHEDULED_SUFFIX}`;

/**
 * BullMQ's OWN custom-id rule, mirrored from bullmq 6.2.0
 * `dist/cjs/classes/job.js:905-913` (`Job.addJob`). It throws BEFORE anything
 * is stored, and `scheduleTransition` used to swallow the throw into
 * `logger.error` — so an id BullMQ rejects loses the job in silence, and a
 * fake `add` that stores whatever it is handed cannot see it. Returns the
 * rejection reason, or `null` when BullMQ would accept the id.
 */
function bullmqJobIdRejection(jobId: string): string | null {
  if (`${parseInt(jobId, 10)}` === jobId) return 'Custom Id cannot be integers';
  if (jobId.includes(':') && jobId.split(':').length !== 3) {
    return 'Custom Id cannot contain :';
  }
  return null;
}

interface FakeJob {
  id: string;
  getState: jest.Mock;
  remove: jest.Mock;
}

function fakeJob(id: string, state: string): FakeJob {
  return {
    id,
    getState: jest.fn().mockResolvedValue(state),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(jobs: Record<string, FakeJob>) {
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = {
    add,
    getJob: jest.fn((id: string) => Promise.resolve(jobs[id])),
  } as unknown as Queue;
  const service = new LineupPhaseQueueService(queue, {} as never);
  return { service, add };
}

describe('LineupPhaseQueueService.scheduleTransition (ROK-1443)', () => {
  it('schedules under the base id when nothing occupies it', async () => {
    const { service, add } = buildService({});

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      { lineupId: 7, targetStatus: 'voting' },
      expect.objectContaining({ jobId: BASE_ID, delay: 60_000 }),
    );
  });

  it('re-schedules under the -r id when the base job is still active (the extension fires from inside its own job)', async () => {
    const active = fakeJob(BASE_ID, 'active');
    const { service, add } = buildService({ [BASE_ID]: active });

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(active.remove).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      { lineupId: 7, targetStatus: 'voting' },
      expect.objectContaining({ jobId: ALT_ID, delay: 60_000 }),
    );
  });

  it('re-schedules under an id BullMQ actually accepts — the original `:r` suffix threw "Custom Id cannot contain :" and the extension was lost (gate round 2, integration case H)', async () => {
    const { service, add } = buildService({
      [BASE_ID]: fakeJob(BASE_ID, 'active'),
    });

    await service.scheduleTransition(7, 'voting', 60_000);

    const opts = add.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).toBe(ALT_ID);
    expect(bullmqJobIdRejection(opts.jobId)).toBeNull();
  });

  it('clears a pending -r twin before re-adding under the free base id', async () => {
    const parked = fakeJob(ALT_ID, 'delayed');
    const { service, add } = buildService({ [ALT_ID]: parked });

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(parked.remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      expect.anything(),
      expect.objectContaining({ jobId: BASE_ID }),
    );
  });

  it('cancelAllForLineup removes a pending -r job too', async () => {
    const parked = fakeJob(ALT_ID, 'delayed');
    const { service } = buildService({ [ALT_ID]: parked });

    const removed = await service.cancelAllForLineup(7);

    expect(removed).toBe(1);
    expect(parked.remove).toHaveBeenCalledTimes(1);
  });
});

/** Queue whose `add` is the supplied mock and which holds no existing jobs. */
function buildServiceWithAdd(add: jest.Mock): LineupPhaseQueueService {
  const queue = {
    add,
    getJob: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue;
  return new LineupPhaseQueueService(queue, {} as never);
}

describe('LineupPhaseQueueService.scheduleTransition failure contract (ROK-1512)', () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
  });

  it('propagates a rejected enqueue instead of swallowing it', async () => {
    const boom = new Error('Custom Id cannot contain :');
    const service = buildServiceWithAdd(jest.fn().mockRejectedValue(boom));

    await expect(service.scheduleTransition(7, 'voting', 60_000)).rejects.toBe(
      boom,
    );
  });

  it('reports the failure to Sentry tagged with the lineup and target', async () => {
    const boom = new Error('Custom Id cannot contain :');
    const service = buildServiceWithAdd(jest.fn().mockRejectedValue(boom));

    await service
      .scheduleTransition(7, 'voting', 60_000)
      .catch(() => undefined);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: {
        context: 'lineup-phase-schedule',
        lineupId: 7,
        targetStatus: 'voting',
      },
    });
  });

  it('keeps the happy-path retry semantics and stays silent on success', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const service = buildServiceWithAdd(add);

    await service.scheduleTransition(7, 'voting', 60_000);

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      LINEUP_PHASE_TRANSITION,
      { lineupId: 7, targetStatus: 'voting' },
      expect.objectContaining({
        jobId: 'lineup-phase-7-voting',
        delay: 60_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      }),
    );
  });
});

/**
 * ROK-1762: queue that also supports `queue.remove(id)`, which drops the id
 * from `jobs` the way BullMQ does, so later probes see it gone.
 */
function buildRetainingService(jobs: Record<string, FakeJob>) {
  const add = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn((id: string) => {
    delete jobs[id];
    return Promise.resolve(1);
  });
  const queue = {
    add,
    remove,
    getJob: jest.fn((id: string) => Promise.resolve(jobs[id])),
  } as unknown as Queue;
  const service = new LineupPhaseQueueService(queue, {} as never);
  return { service, add, remove };
}

/** The jobId the single `add` call landed under. */
function addedJobId(add: jest.Mock): string {
  expect(add).toHaveBeenCalledTimes(1);
  return (add.mock.calls[0][2] as { jobId: string }).jobId;
}

describe('LineupPhaseQueueService retained finished jobs (ROK-1762)', () => {
  it.each(['completed', 'failed'])(
    'scheduleTransition clears a retained %s base job and lands under the base id',
    async (state) => {
      const { service, add, remove } = buildRetainingService({
        [BASE_ID]: fakeJob(BASE_ID, state),
      });

      await service.scheduleTransition(7, 'voting', 60_000);

      expect(remove).toHaveBeenCalledWith(BASE_ID);
      expect(addedJobId(add)).toBe(BASE_ID);
    },
  );

  it.each([
    ['failed', 'failed'],
    ['completed', 'failed'],
    ['failed', 'completed'],
  ])(
    'scheduleTransition still lands when base is %s AND its -r twin is %s (was silently dropped)',
    async (baseState, altState) => {
      const { service, add, remove } = buildRetainingService({
        [BASE_ID]: fakeJob(BASE_ID, baseState),
        [ALT_ID]: fakeJob(ALT_ID, altState),
      });

      await service.scheduleTransition(7, 'voting', 60_000);

      expect(remove).toHaveBeenCalledWith(BASE_ID);
      expect(remove).toHaveBeenCalledWith(ALT_ID);
      expect(addedJobId(add)).toBe(BASE_ID);
    },
  );

  it.each(['completed', 'failed'])(
    'scheduleTransition clears a retained %s -r twin when the base is active, then lands under -r',
    async (altState) => {
      const active = fakeJob(BASE_ID, 'active');
      const { service, add, remove } = buildRetainingService({
        [BASE_ID]: active,
        [ALT_ID]: fakeJob(ALT_ID, altState),
      });

      await service.scheduleTransition(7, 'voting', 60_000);

      expect(active.remove).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith(ALT_ID);
      expect(remove).not.toHaveBeenCalledWith(BASE_ID);
      expect(addedJobId(add)).toBe(ALT_ID);
    },
  );

  it.each(['completed', 'failed'])(
    'scheduleGraceAdvance clears a retained %s grace job before adding',
    async (state) => {
      const graceId = 'lineup-grace-7';
      const { service, add, remove } = buildRetainingService({
        [graceId]: fakeJob(graceId, state),
      });

      await service.scheduleGraceAdvance(7, 30_000);

      expect(remove).toHaveBeenCalledWith(graceId);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
        add.mock.invocationCallOrder[0] ?? -Infinity,
      );
      expect(addedJobId(add)).toBe(graceId);
    },
  );

  it('scheduleGraceAdvance still replaces a pending grace job (unchanged)', async () => {
    const graceId = 'lineup-grace-7';
    const pending = fakeJob(graceId, 'delayed');
    const { service, add, remove } = buildRetainingService({
      [graceId]: pending,
    });

    await service.scheduleGraceAdvance(7, 30_000);

    expect(remove).not.toHaveBeenCalled();
    expect(pending.remove).toHaveBeenCalledTimes(1);
    expect(addedJobId(add)).toBe(graceId);
  });
});
