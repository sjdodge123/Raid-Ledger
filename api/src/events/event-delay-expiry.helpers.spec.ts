/**
 * Unit test: the event_delayed notice expires at the event's NEW end
 * (TDB:196 expiry half) — a delay notice is stale once the event is over.
 */
import { applyEventDelay } from './event-delay.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NotificationService } from '../notifications/notification.service';

jest.mock('./event-lifecycle.helpers', () => ({
  findExistingOrThrow: jest.fn(),
  assertOwnerOrAdmin: jest.fn(),
  getSignedUpUserIds: jest.fn(),
}));
jest.mock('../notifications/timezone.helpers', () => ({
  resolveUserTimezones: jest.fn(),
}));

import * as lifecycle from './event-lifecycle.helpers';
import * as tz from '../notifications/timezone.helpers';

const START = new Date('2026-07-15T01:00:00Z');
const END = new Date('2026-07-15T03:00:00Z');

describe('applyEventDelay — notice expiry (TDB:196)', () => {
  let mockDb: MockDb;
  let createMany: jest.Mock;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    createMany = jest.fn().mockResolvedValue(undefined);
    (lifecycle.findExistingOrThrow as jest.Mock).mockResolvedValue({
      id: 7,
      title: 'D&d night',
      creatorId: 1,
      duration: [START, END],
    });
    (lifecycle.getSignedUpUserIds as jest.Mock).mockResolvedValue([1, 2, 3]);
    (tz.resolveUserTimezones as jest.Mock).mockResolvedValue(new Map());
  });

  it('sets expiresAt = the delayed end on every event_delayed row', async () => {
    const notificationService = {
      createMany,
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    } as unknown as NotificationService;

    const { newEnd } = await applyEventDelay(
      mockDb as unknown as PostgresJsDatabase<typeof schema>,
      notificationService,
      7,
      15,
      1,
    );

    const rows = createMany.mock.calls[0][0] as Array<{
      userId: number;
      type: string;
      expiresAt?: Date;
    }>;
    expect(rows.map((r) => r.userId)).toEqual([2, 3]);
    expect(newEnd.toISOString()).toBe('2026-07-15T03:15:00.000Z');
    for (const r of rows) {
      expect(r.type).toBe('event_delayed');
      expect(r.expiresAt?.toISOString()).toBe('2026-07-15T03:15:00.000Z');
    }
  });
});
