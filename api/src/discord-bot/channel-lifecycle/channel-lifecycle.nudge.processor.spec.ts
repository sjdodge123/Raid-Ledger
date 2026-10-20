import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import * as Sentry from '@sentry/node';
import { QueueHealthService } from '../../queue/queue-health.service';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import { CHANNEL_LIFECYCLE_NUDGE_QUEUE } from './channel-lifecycle.nudge';
import {
  ChannelLifecycleNudgeProcessor,
  isFinalAttempt,
  type NudgeJob,
} from './channel-lifecycle.nudge.processor';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

describe('ChannelLifecycleNudgeProcessor', () => {
  const lifecycle = { reconcile: jest.fn() };
  const queueHealth = { register: jest.fn() };
  let processor: ChannelLifecycleNudgeProcessor;

  const job = (attemptsMade: number): NudgeJob => ({
    data: { gameId: 9 },
    attemptsMade,
    opts: { attempts: 2 },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    lifecycle.reconcile.mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelLifecycleNudgeProcessor,
        { provide: getQueueToken(CHANNEL_LIFECYCLE_NUDGE_QUEUE), useValue: {} },
        { provide: ChannelLifecycleService, useValue: lifecycle },
        { provide: QueueHealthService, useValue: queueHealth },
      ],
    }).compile();
    processor = moduleRef.get(ChannelLifecycleNudgeProcessor);
  });

  it('runs a non-dry single-game reconcile with the nudge trigger', async () => {
    await processor.process(job(0));
    expect(lifecycle.reconcile).toHaveBeenCalledWith({
      dryRun: false,
      trigger: 'nudge',
      gameIds: [9],
    });
  });

  it('skips quietly when another reconcile holds the lock', async () => {
    lifecycle.reconcile.mockRejectedValue(new ConflictException('busy'));
    await expect(processor.process(job(0))).resolves.toBeUndefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('rethrows for a retry without Sentry on the first attempt', async () => {
    lifecycle.reconcile.mockRejectedValue(new Error('boom'));
    await expect(processor.process(job(0))).rejects.toThrow('boom');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures to Sentry exactly once, on the final attempt', async () => {
    lifecycle.reconcile.mockRejectedValue(new Error('boom'));
    await expect(processor.process(job(1))).rejects.toThrow('boom');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('isFinalAttempt treats a job without attempts as single-shot', () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 2 } })).toBe(
      false,
    );
  });
});
