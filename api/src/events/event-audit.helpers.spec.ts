/**
 * Unit tests for the event-mutation audit writes: a rejected activity-log
 * insert is reported (logger + Sentry) and never rethrown into a cancel,
 * reschedule or roster update that already committed.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  auditEventCancelled,
  auditEventRescheduled,
  auditRosterReconfirms,
} from './event-audit.helpers';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
}));

const captureException = jest.mocked(Sentry.captureException);

describe('event audit helpers', () => {
  let errorSpy: jest.SpyInstance;
  const err = new Error('audit down');

  beforeEach(() => {
    captureException.mockClear();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('auditEventCancelled resolves and reports when the insert rejects', async () => {
    const activityLog = { log: jest.fn().mockRejectedValue(err) };
    await expect(
      auditEventCancelled(activityLog, 7, 3, 'raid lead sick'),
    ).resolves.toBeUndefined();
    expect(activityLog.log).toHaveBeenCalledWith(
      'event',
      7,
      'event_cancelled',
      3,
      { reason: 'raid lead sick' },
    );
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { activityLog: 'event_cancelled' },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Activity log write failed (event_cancelled on event 7)',
      expect.stringContaining('audit down'),
    );
  });

  it('auditEventRescheduled resolves and reports when the insert rejects', async () => {
    const activityLog = { log: jest.fn().mockRejectedValue(err) };
    const oldStart = '2026-02-10T18:00:00.000Z';
    const newStart = '2026-02-11T18:00:00.000Z';
    await expect(
      auditEventRescheduled(activityLog, 7, 3, oldStart, newStart),
    ).resolves.toBeUndefined();
    expect(activityLog.log).toHaveBeenCalledWith(
      'event',
      7,
      'event_rescheduled',
      3,
      { oldStart, newStart },
    );
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { activityLog: 'event_rescheduled' },
    });
  });

  it('auditRosterReconfirms writes every attendee even when the first insert rejects', async () => {
    const activityLog = {
      log: jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce(undefined),
    };
    await expect(
      auditRosterReconfirms(activityLog, 7, [11, 12]),
    ).resolves.toBeUndefined();
    expect(activityLog.log).toHaveBeenCalledTimes(2);
    expect(activityLog.log).toHaveBeenNthCalledWith(
      2,
      'event',
      7,
      'signup_reconfirmed',
      12,
      { reason: 'roster-update' },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { activityLog: 'signup_reconfirmed' },
    });
  });
});
