/**
 * logDiscordAck runs after the Discord reschedule-DM confirm has already
 * been written; a failed audit insert must be reported, not rethrown.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { logDiscordAck } from './reschedule-response.helpers';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
}));

const captureException = jest.mocked(Sentry.captureException);

describe('logDiscordAck — best-effort audit', () => {
  let errorSpy: jest.SpyInstance;
  const err = new Error('audit down');

  beforeEach(() => {
    captureException.mockClear();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('resolves and reports when the signup_reconfirmed insert rejects', async () => {
    const activityLog = { log: jest.fn().mockRejectedValue(err) };
    const set = { confirmationStatus: 'confirmed' };
    await expect(
      logDiscordAck({ activityLog }, 9, true, set, { discordUserId: 'd-1' }),
    ).resolves.toBeUndefined();
    expect(activityLog.log).toHaveBeenCalledWith(
      'event',
      9,
      'signup_reconfirmed',
      null,
      { reason: 'discord-ack', discordUserId: 'd-1' },
    );
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { activityLog: 'signup_reconfirmed' },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Activity log write failed (signup_reconfirmed on event 9)',
      expect.stringContaining('audit down'),
    );
  });
});
