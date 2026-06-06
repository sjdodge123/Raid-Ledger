/**
 * Unit tests for withCapacityRecovery (ROK-1332 + ROK-1347 refinement).
 *
 * The wrapper catches Discord 30038 (cap reached), runs the GC sweep, and
 * retries once. ROK-1347: `freed` now includes reclaimed RL duplicates, so the
 * wrapper only throws CapacityStillSaturatedError when GC freed NOTHING. Delete
 * failures are logged with their codes. gcStaleRLScheduledEvents is mocked.
 */
import { Logger } from '@nestjs/common';
import { withCapacityRecovery } from './scheduled-event.capacity';
import * as gc from './scheduled-event.gc';
import { CapacityStillSaturatedError } from './scheduled-event.helpers';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';

jest.mock('./scheduled-event.gc', () => ({
  gcStaleRLScheduledEvents: jest.fn(),
}));

const gcMock = gc.gcStaleRLScheduledEvents as jest.MockedFunction<
  typeof gc.gcStaleRLScheduledEvents
>;

const guild = {} as Parameters<typeof withCapacityRecovery>[0];
const db = {} as Parameters<typeof withCapacityRecovery>[1];
const logger = new Logger('test');

beforeEach(() => gcMock.mockReset());

function capError() {
  return makeDiscordApiError(30038, 'Maximum number of scheduled events');
}

describe('withCapacityRecovery', () => {
  it('passes through when fn succeeds first time (no GC)', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await withCapacityRecovery(guild, db, logger, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(gcMock).not.toHaveBeenCalled();
  });

  it('rethrows non-capacity errors without GC', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('other'));
    await expect(withCapacityRecovery(guild, db, logger, fn)).rejects.toThrow(
      'other',
    );
    expect(gcMock).not.toHaveBeenCalled();
  });

  it('on 30038 runs GC and retries fn once when GC freed > 0', async () => {
    gcMock.mockResolvedValue({ freed: 2, orphanCount: 1, deleteFailures: [] });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(capError())
      .mockResolvedValueOnce(undefined);

    await withCapacityRecovery(guild, db, logger, fn);

    expect(gcMock).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws CapacityStillSaturatedError when GC freed 0 (only operator orphans)', async () => {
    gcMock.mockResolvedValue({ freed: 0, orphanCount: 80, deleteFailures: [] });
    const fn = jest.fn().mockRejectedValue(capError());

    await expect(withCapacityRecovery(guild, db, logger, fn)).rejects.toThrow(
      CapacityStillSaturatedError,
    );
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it('retries (does NOT throw) when GC reclaimed RL duplicates even if orphans remain', async () => {
    // The ROK-1347 fix: reclaiming a duplicate counts toward freed → retry.
    gcMock.mockResolvedValue({ freed: 1, orphanCount: 5, deleteFailures: [] });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(capError())
      .mockResolvedValueOnce(undefined);

    await expect(
      withCapacityRecovery(guild, db, logger, fn),
    ).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('logs delete-failure codes when GC could not free some SEs', async () => {
    gcMock.mockResolvedValue({
      freed: 1,
      orphanCount: 0,
      deleteFailures: [{ eventId: 9, seId: 'se-x', code: 50013 }],
    });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fn = jest
      .fn()
      .mockRejectedValueOnce(capError())
      .mockResolvedValueOnce(undefined);

    try {
      await withCapacityRecovery(guild, db, logger, fn);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('50013'));
    } finally {
      warn.mockRestore();
    }
  });
});
