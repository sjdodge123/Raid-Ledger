import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import * as Sentry from '@sentry/nestjs';
import { QueueHealthService } from '../../queue/queue-health.service';
import { ChannelLifecycleService } from './channel-lifecycle.service';
import { CHANNEL_LIFECYCLE_NUDGE_QUEUE } from './channel-lifecycle.nudge';
import {
  ChannelLifecycleNudgeProcessor,
  isFinalAttempt,
  type NudgeJob,
} from './channel-lifecycle.nudge.processor';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

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
    lifecycle.reconcile.mockResolvedValue({ stoppedReason: null, items: [] });
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

  describe('an unsuccessful reconcile result retries (Codex r3 P2)', () => {
    const result = (o: object): object => ({
      stoppedReason: null,
      items: [],
      ...o,
    });
    const item = (gameId: number, outcome: string): object => ({
      gameId,
      gameName: 'G',
      action: 'create',
      outcome,
      detail: null,
    });

    it.each(['failed', 'deferred'])(
      'a %s item for the nudged game throws so BullMQ retries',
      async (outcome) => {
        lifecycle.reconcile.mockResolvedValue(
          result({ items: [item(9, outcome)] }),
        );
        await expect(processor.process(job(0))).rejects.toThrow(/game 9/);
        expect(Sentry.captureException).not.toHaveBeenCalled();
      },
    );

    it('a stopped tick (offline) throws; the final attempt captures once', async () => {
      lifecycle.reconcile.mockResolvedValue(result({ stoppedReason: 'offline' }));
      await expect(processor.process(job(1))).rejects.toThrow(/offline/);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('a done item resolves', async () => {
      lifecycle.reconcile.mockResolvedValue(
        result({ items: [item(9, 'done'), item(3, 'failed')] }),
      );
      await expect(processor.process(job(0))).resolves.toBeUndefined();
    });

    it('a disabled setting is a no-op, not a failure', async () => {
      lifecycle.reconcile.mockResolvedValue(
        result({ stoppedReason: 'disabled' }),
      );
      await expect(processor.process(job(0))).resolves.toBeUndefined();
    });
  });
});
