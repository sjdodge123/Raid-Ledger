/**
 * ROK-1512 — `scheduleTransitionBestEffort` is the ONLY place a failed
 * `scheduleTransition` is allowed to be swallowed, and it must say so.
 */
import { Logger } from '@nestjs/common';
import { scheduleTransitionBestEffort } from './lineup-phase-schedule.helpers';

describe('scheduleTransitionBestEffort (ROK-1512)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('passes the call through unchanged and reports success', async () => {
    const queue = {
      scheduleTransition: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      scheduleTransitionBestEffort(queue, 7, 'voting', 1_000, 'test'),
    ).resolves.toBe(true);

    expect(queue.scheduleTransition).toHaveBeenCalledWith(7, 'voting', 1_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('swallows a rejected schedule, names the site and cause, and reports failure', async () => {
    const queue = {
      scheduleTransition: jest
        .fn()
        .mockRejectedValue(new Error('Custom Id cannot contain :')),
    };

    await expect(
      scheduleTransitionBestEffort(queue, 7, 'voting', 1_000, 'createLineup'),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('[createLineup]');
    expect(line).toContain('lineup 7');
    expect(line).toContain('Custom Id cannot contain :');
  });
});
