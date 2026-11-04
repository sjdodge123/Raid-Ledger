import { BadRequestException } from '@nestjs/common';
import { parseUpdatePreferencesBody } from './notification-prefs.helpers';

/** Returns the BadRequestException's `errors` list, or fails the test. */
function rejectionErrors(body: unknown): string[] {
  try {
    parseUpdatePreferencesBody(body);
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const response = error.getResponse();
    if (typeof response === 'object' && 'errors' in response) {
      const { errors } = response;
      if (Array.isArray(errors)) return errors.map(String);
    }
    throw new Error('BadRequestException carried no errors list', {
      cause: error,
    });
  }
  throw new Error(`expected ${JSON.stringify(body)} to be rejected`);
}

describe('parseUpdatePreferencesBody', () => {
  it('accepts a valid partial body and returns it unchanged', () => {
    const body = {
      channelPrefs: {
        event_reminder: { discord: false },
        slot_vacated: { inApp: true, push: false },
      },
    };
    expect(parseUpdatePreferencesBody(body)).toEqual(body);
  });

  it('rejects an unknown notification type', () => {
    const errors = rejectionErrors({
      channelPrefs: { not_a_type: { inApp: true } },
    });
    expect(errors).toEqual([
      expect.stringMatching(/^channelPrefs: .*"not_a_type"/),
    ]);
  });

  it('rejects an unknown channel key', () => {
    const errors = rejectionErrors({
      channelPrefs: { event_reminder: { email: true } },
    });
    expect(errors).toEqual([
      expect.stringMatching(/^channelPrefs\.event_reminder: .*"email"/),
    ]);
  });

  it('rejects a non-boolean channel value', () => {
    const errors = rejectionErrors({
      channelPrefs: { event_reminder: { discord: 'x' } },
    });
    expect(errors).toEqual([
      expect.stringContaining('channelPrefs.event_reminder.discord'),
    ]);
  });

  it('rejects unknown top-level keys and a missing channelPrefs', () => {
    expect(rejectionErrors({ channelPrefs: {}, extra: 1 })).toEqual([
      expect.stringContaining('"extra"'),
    ]);
    expect(rejectionErrors({})).toEqual([
      expect.stringContaining('channelPrefs'),
    ]);
  });
});
