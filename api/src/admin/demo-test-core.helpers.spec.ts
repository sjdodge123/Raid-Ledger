import type { ModuleRef } from '@nestjs/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
  buildAwaitProcessingFailure,
  getNotificationsForTest,
} from './demo-test-core.helpers';
import { ConflictException, Logger } from '@nestjs/common';

type Db = PostgresJsDatabase<typeof schema>;

function mockModuleRef(overrides: Record<string, unknown>): ModuleRef {
  return {
    get: jest.fn().mockImplementation((token: unknown) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return overrides[name] ?? {};
    }),
  } as unknown as ModuleRef;
}

/**
 * QueueHealthService whose awaitDrained times out while one queue is still
 * busy and one job has failed (ROK-1511 fixture).
 */
function busyQueuesModuleRef(): ModuleRef {
  return mockModuleRef({
    QueueHealthService: {
      awaitDrained: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'awaitDrained timed out after 5000ms — queues still have pending jobs',
          ),
        ),
      getHealthStatus: jest.fn().mockResolvedValue([
        {
          name: 'discord-embed-sync',
          waiting: 0,
          active: 0,
          completed: 1,
          failed: 1,
          delayed: 1,
        },
        {
          name: 'bench-promotion',
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
      ]),
      getFailedJobs: jest.fn().mockResolvedValue([
        {
          queue: 'event-lifecycle',
          jobId: 'event-created-139',
          name: 'event-created',
          error:
            'violates foreign key constraint "discord_event_messages_event_id_events_id_fk"',
          attemptsMade: 3,
        },
      ]),
    },
  });
}

/** Render the single where() argument the mocked chain received. */
function renderWhere(db: MockDb): { sql: string; params: unknown[] } {
  const [whereArg] = db.where.mock.calls[0] as [SQL];
  return new PgDialect().sqlToQuery(whereArg);
}

describe('demo-test-core.helpers - prefs, Discord link, game-time confirmation', () => {
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
});

describe('demo-test-core.helpers - queue flush and await', () => {
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

describe('demo-test-core.helpers - await-processing failure body (ROK-1511)', () => {
  it('awaitProcessingForTest reports the blocking queue and failed job instead of a bare 500 (ROK-1511)', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const moduleRef = busyQueuesModuleRef();

    const err = await awaitProcessingForTest(moduleRef, 5000).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse();
    expect(body).toMatchObject({
      error: 'await-processing-failed',
      timeoutMs: 5000,
      message: expect.stringContaining('timed out'),
      busyQueues: [{ name: 'discord-embed-sync', delayed: 1, failed: 1 }],
      failedJobs: [
        {
          queue: 'event-lifecycle',
          jobId: 'event-created-139',
          error: expect.stringContaining('foreign key'),
        },
      ],
    });
    // The idle queue is excluded — the body names only what is blocking.
    expect((body as { busyQueues: unknown[] }).busyQueues).toHaveLength(1);
    jest.restoreAllMocks();
  });

  it('buildAwaitProcessingFailure drops idle queues and stringifies non-Error causes (ROK-1511)', () => {
    const body = buildAwaitProcessingFailure(
      1000,
      'boom',
      [
        {
          name: 'idle',
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        {
          name: 'busy',
          waiting: 2,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
      ],
      [],
    );

    expect(body.message).toBe('boom');
    expect(body.busyQueues).toEqual([
      { name: 'busy', waiting: 2, active: 0, delayed: 0, failed: 0 },
    ]);
  });
});

/**
 * MUTATION: drop the `type` condition in getNotificationsForTest and the
 * type-filter case fails on `params` ([3] instead of [3, 'dm']); hardcode
 * `.limit(20)` and it fails on `limit` being called with 20, not 50.
 */
describe('demo-test-core.helpers - getNotificationsForTest', () => {
  let db: MockDb;

  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('defaults to 20 rows and filters on the user only', async () => {
    const rows = [{ id: 1, userId: 3, type: 'dm' }];
    db.limit.mockResolvedValue(rows);

    const result = await getNotificationsForTest(db as unknown as Db, 3);

    expect(result).toEqual(rows);
    expect(db.limit).toHaveBeenCalledWith(20);
    expect(db.where).toHaveBeenCalledTimes(1);
    const where = renderWhere(db);
    expect(where.params).toEqual([3]);
    expect(where.params).not.toContain('dm');
    expect(where.sql).not.toContain('"type"');
  });

  it('adds the type filter and forwards a custom limit', async () => {
    db.limit.mockResolvedValue([]);

    const result = await getNotificationsForTest(
      db as unknown as Db,
      3,
      'dm',
      50,
    );

    expect(result).toEqual([]);
    expect(db.limit).toHaveBeenCalledWith(50);
    expect(db.where).toHaveBeenCalledTimes(1);
    const where = renderWhere(db);
    expect(where.params).toEqual([3, 'dm']);
    expect(where.sql).toContain('"notifications"."type" = $2');
  });
});
