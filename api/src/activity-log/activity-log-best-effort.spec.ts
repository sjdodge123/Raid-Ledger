/**
 * Unit tests for best-effort audit writes: a rejected insert is logged and
 * sent to Sentry, never rethrown into the request that already succeeded.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { logBestEffort } from './activity-log-best-effort';
import {
  finalizeDuplicate,
  healPendingFromDiscord,
} from '../events/signups-reconfirm.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
}));

const captureException = jest.mocked(Sentry.captureException);

function rejectingLog(err: Error) {
  return { log: jest.fn().mockRejectedValue(err) };
}

describe('logBestEffort', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    captureException.mockClear();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('resolves, logs once and captures once, tagged with the action, when the insert rejects', async () => {
    const err = new Error('audit down');
    const activityLog = rejectingLog(err);
    await expect(
      logBestEffort(activityLog, 'event', 5, 'signup_added', 9, { role: null }),
    ).resolves.toBeUndefined();
    expect(activityLog.log).toHaveBeenCalledWith(
      'event',
      5,
      'signup_added',
      9,
      { role: null },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { activityLog: 'signup_added' },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Activity log write failed (signup_added on event 5)',
      expect.stringContaining('audit down'),
    );
  });

  it('captures nothing when the insert succeeds', async () => {
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    await logBestEffort(activityLog, 'event', 5, 'signup_cancelled', 9);
    expect(captureException).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('signups-reconfirm audit writes are best-effort', () => {
  beforeEach(() => {
    captureException.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('finalizeDuplicate returns the response when the reactivation and reconfirm audits fail', async () => {
    const activityLog = rejectingLog(new Error('audit down'));
    const response = {
      id: 1,
      status: 'signed_up',
    } as never;
    const result = await finalizeDuplicate(activityLog, 3, {
      reactivated: true,
      reconfirmed: true,
      reconfirmedUserId: 42,
      response,
    });
    expect(result).toBe(response);
    expect(activityLog.log).toHaveBeenCalledTimes(2);
    expect(captureException.mock.calls.map((c) => c[1])).toEqual([
      { tags: { activityLog: 'signup_status_changed' } },
      { tags: { activityLog: 'signup_reconfirmed' } },
    ]);
  });

  it('healPendingFromDiscord reports the heal when its audit fails', async () => {
    const activityLog = rejectingLog(new Error('audit down'));
    const db = createDrizzleMock();
    db.limit.mockResolvedValueOnce([{ role: 'tank' }]);
    db.where.mockReturnValueOnce(db).mockResolvedValueOnce(undefined);
    const healed = await healPendingFromDiscord(db as never, activityLog, {
      id: 7,
      eventId: 3,
      confirmationStatus: 'pending',
      user: { id: 42 },
    });
    expect(healed).toBe(true);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { activityLog: 'signup_reconfirmed' },
    });
  });
});
