/**
 * fireRosterNotifications — failure logging.
 * NestJS Logger treats a trailing string argument as the log CONTEXT and never
 * substitutes printf tokens, so the failure reason must be part of the message.
 */
import { fireRosterNotifications } from './signups-roster-ops.helpers';

describe('fireRosterNotifications — failure logging', () => {
  it('logs the context-fetch failure reason inside the message', async () => {
    const logger = { log: jest.fn(), warn: jest.fn() };
    fireRosterNotifications(
      {} as never,
      7,
      'Raid Night',
      [],
      new Map(),
      new Map(),
      () => Promise.reject(new Error('ctx down')),
      logger,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to fetch notification context: ctx down',
    );
  });
});
