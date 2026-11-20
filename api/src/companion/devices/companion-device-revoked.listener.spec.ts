/**
 * Backlog 2026-11-19 (ROK-2099 S2/S3 review) — a failed revoke cleanup
 * DELETE must reach Sentry, not only the log; the listener still never throws.
 */
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { CompanionDeviceRevokedListener } from './companion-device-revoked.listener';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const capture = jest.mocked(Sentry.captureException);

function listenerWithDelete(where: jest.Mock): CompanionDeviceRevokedListener {
  const db = { delete: jest.fn(() => ({ where })) };
  return new CompanionDeviceRevokedListener(
    db as unknown as PostgresJsDatabase<typeof schema>,
  );
}

describe('CompanionDeviceRevokedListener.onRevoked', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports nothing when the cleanup DELETE succeeds', async () => {
    const listener = listenerWithDelete(jest.fn().mockResolvedValue(undefined));
    await listener.onRevoked({ userId: 7, deviceId: 3 });
    expect(capture).not.toHaveBeenCalled();
  });

  it('reports a failed cleanup DELETE to Sentry and does not throw', async () => {
    const boom = new Error('connection reset');
    const listener = listenerWithDelete(jest.fn().mockRejectedValue(boom));
    await expect(
      listener.onRevoked({ userId: 7, deviceId: 3 }),
    ).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledWith(boom, {
      tags: { context: 'companion-device-revoke-cleanup' },
      extra: { userId: 7, deviceId: 3 },
    });
  });
});
