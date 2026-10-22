import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SettingsService } from '../../settings/settings.service';
import {
  CHANNEL_LIFECYCLE_NUDGE_QUEUE,
  GameActivityNudge,
  NUDGE_DELAY_MS,
  nudgeJobId,
} from './channel-lifecycle.nudge';

describe('GameActivityNudge', () => {
  const queue = { add: jest.fn(), getJob: jest.fn(), remove: jest.fn() };
  const settings = { getChannelLifecycleSettings: jest.fn() };
  let nudge: GameActivityNudge;

  /** Let the fire-and-forget promise chain settle. */
  const flush = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    jest.clearAllMocks();
    queue.getJob.mockResolvedValue(undefined);
    queue.add.mockResolvedValue(undefined);
    settings.getChannelLifecycleSettings.mockResolvedValue({ enabled: true });
    const moduleRef = await Test.createTestingModule({
      providers: [
        GameActivityNudge,
        {
          provide: getQueueToken(CHANNEL_LIFECYCLE_NUDGE_QUEUE),
          useValue: queue,
        },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    nudge = moduleRef.get(GameActivityNudge);
  });

  it('enqueues a 60 s delayed, per-game deduped job with 2 attempts', async () => {
    await expect(nudge.enqueue(42)).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-game',
      { gameId: 42 },
      expect.objectContaining({
        jobId: 'channel-lifecycle-game-42',
        delay: NUDGE_DELAY_MS,
        attempts: 2,
      }),
    );
  });

  it('uses one job id per game so a vote storm collapses into one job', () => {
    expect(nudgeJobId(7)).toBe(nudgeJobId(7));
    expect(nudgeJobId(7)).not.toBe(nudgeJobId(8));
  });

  it('enqueues nothing when the lifecycle setting is disabled', async () => {
    settings.getChannelLifecycleSettings.mockResolvedValue({ enabled: false });
    await expect(nudge.enqueue(42)).resolves.toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('touch is fire-and-forget: a queue failure never reaches the caller', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));
    expect(() => nudge.touch(5)).not.toThrow();
    await flush();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('touch ignores a missing game id', async () => {
    nudge.touch(null);
    nudge.touch(undefined);
    await flush();
    expect(settings.getChannelLifecycleSettings).not.toHaveBeenCalled();
  });
});
