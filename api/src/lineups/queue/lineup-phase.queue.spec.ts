/**
 * ROK-1512 — `LineupPhaseQueueService.scheduleTransition` failure contract.
 *
 * A failed enqueue used to be swallowed into `logger.error`; BullMQ rejected
 * a job id and the deadline job silently ceased to exist for two ROK-1443
 * gate rounds. The contract now: capture to Sentry (tagged with the lineup
 * and target) AND rethrow. Callers that must keep going opt in via
 * `scheduleTransitionBestEffort`.
 */
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { LineupPhaseQueueService } from './lineup-phase.queue';
import { LINEUP_PHASE_TRANSITION } from './lineup-phase.constants';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

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

    await service.scheduleTransition(7, 'voting', 60_000).catch(() => undefined);

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
