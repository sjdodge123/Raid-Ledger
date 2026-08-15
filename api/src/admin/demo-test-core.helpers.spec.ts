import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { NOTIFICATION_TYPES } from '../drizzle/schema/notification-preferences';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  buildAllChannelsEnabled,
  enableDiscordNotificationsForTest,
  linkDiscordForTest,
  clearGameTimeConfirmationForTest,
  flushNotificationBufferForTest,
  flushEmbedQueueForTest,
  awaitProcessingForTest,
} from './demo-test-core.helpers';

type Db = PostgresJsDatabase<typeof schema>;

function mockModuleRef(overrides: Record<string, unknown>): ModuleRef {
  return {
    get: jest.fn().mockImplementation((token: unknown) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return overrides[name] ?? {};
    }),
  } as unknown as ModuleRef;
}

describe('demo-test-core.helpers', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('buildAllChannelsEnabled enables every channel for every type', () => {
    const prefs = buildAllChannelsEnabled() as Record<
      string,
      Record<string, boolean>
    >;
    expect(Object.keys(prefs)).toHaveLength(NOTIFICATION_TYPES.length);
    for (const type of NOTIFICATION_TYPES) {
      expect(prefs[type]).toEqual({ inApp: true, push: true, discord: true });
    }
  });

  it('enableDiscordNotificationsForTest upserts all-enabled prefs', async () => {
    await enableDiscordNotificationsForTest(db as unknown as Db, 3);
    expect(db.insert).toHaveBeenCalled();
    expect(db.values).toHaveBeenCalledWith({
      userId: 3,
      channelPrefs: buildAllChannelsEnabled(),
    });
    expect(db.onConflictDoUpdate).toHaveBeenCalled();
  });

  it('linkDiscordForTest returns the updated user row', async () => {
    const user = { id: 3, discordId: 'd-1', username: 'smoke' };
    db.returning.mockResolvedValue([user]);

    const updated = await linkDiscordForTest(
      db as unknown as Db,
      3,
      'd-1',
      'smoke',
    );

    // Two updates: clear the ID from other users, then link this user.
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updated).toEqual(user);
  });

  it('clearGameTimeConfirmationForTest nulls the confirmation column', async () => {
    await clearGameTimeConfirmationForTest(db as unknown as Db, 3);
    expect(db.set).toHaveBeenCalledWith({ gameTimeConfirmedAt: null });
  });

  it('flushNotificationBufferForTest flushes and returns pending count', async () => {
    const flushAll = jest.fn().mockResolvedValue(undefined);
    const moduleRef = mockModuleRef({
      RosterNotificationBufferService: { pendingCount: 4, flushAll },
    });

    const count = await flushNotificationBufferForTest(moduleRef);

    expect(count).toBe(4);
    expect(flushAll).toHaveBeenCalled();
  });

  it('flushEmbedQueueForTest drains all queues', async () => {
    const drainAll = jest.fn().mockResolvedValue(undefined);
    const moduleRef = mockModuleRef({ QueueHealthService: { drainAll } });

    const result = await flushEmbedQueueForTest(moduleRef);

    expect(result).toEqual({ success: true });
    expect(drainAll).toHaveBeenCalled();
  });

  it('awaitProcessingForTest forwards the timeout', async () => {
    const awaitDrained = jest.fn().mockResolvedValue(undefined);
    const moduleRef = mockModuleRef({ QueueHealthService: { awaitDrained } });

    await awaitProcessingForTest(moduleRef, 5000);

    expect(awaitDrained).toHaveBeenCalledWith(5000);
  });
});
