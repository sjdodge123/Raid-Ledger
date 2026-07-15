/**
 * Unit tests for notifyAttendeeRunningLate (ROK-1379 follow-up).
 */
import { notifyAttendeeRunningLate } from './running-late-notify.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type { MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

const EVENT = {
  id: 239,
  title: 'D&d night',
  duration: [
    new Date('2026-07-15T01:00:00Z'),
    new Date('2026-07-15T03:00:00Z'),
  ],
  creatorId: 1,
};
const LATE_USER_ID = 106;

describe('notifyAttendeeRunningLate', () => {
  let mockDb: MockDb;
  let notificationService: {
    createMany: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };

  const run = () =>
    notifyAttendeeRunningLate({
      db: mockDb as unknown as PostgresJsDatabase<typeof schema>,
      notificationService,
      event: EVENT,
      lateUserId: LATE_USER_ID,
      lateUsername: 'hiphoptobop',
    });

  beforeEach(() => {
    mockDb = createDrizzleMock();
    notificationService = {
      createMany: jest.fn().mockResolvedValue(undefined),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue('https://discord/msg'),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue('voice-1'),
    };
  });

  it('notifies active attendees + host, excluding the late user', async () => {
    mockDb.where.mockResolvedValue([
      { userId: 1 },
      { userId: LATE_USER_ID },
      { userId: 109 },
    ]);
    await run();
    const created = notificationService.createMany.mock.calls[0][0] as Array<{
      userId: number;
      type: string;
      title: string;
      message: string;
      payload: Record<string, unknown>;
    }>;
    expect(created.map((n) => n.userId).sort()).toEqual([1, 109]);
    expect(created[0].type).toBe('running_late');
    expect(created[0].title).toBe('Running Late');
    expect(created[0].message).toBe(
      'hiphoptobop is running late to "D&d night".',
    );
  });

  it('includes the host even without a signup row and dedupes', async () => {
    mockDb.where.mockResolvedValue([{ userId: 109 }, { userId: 109 }]);
    await run();
    const created = notificationService.createMany.mock.calls[0][0] as Array<{
      userId: number;
    }>;
    expect(created.map((n) => n.userId).sort()).toEqual([1, 109]);
  });

  it('builds a payload with event link, subtype and start time', async () => {
    mockDb.where.mockResolvedValue([{ userId: 109 }]);
    await run();
    const created = notificationService.createMany.mock.calls[0][0] as Array<{
      payload: Record<string, unknown>;
    }>;
    expect(created[0].payload).toMatchObject({
      eventId: 239,
      lateUserId: LATE_USER_ID,
      lateUsername: 'hiphoptobop',
      subtype: `late-${LATE_USER_ID}`,
      startTime: EVENT.duration[0].toISOString(),
      discordUrl: 'https://discord/msg',
      voiceChannelId: 'voice-1',
    });
  });

  it('does nothing when the late user is the only involved person', async () => {
    mockDb.where.mockResolvedValue([{ userId: LATE_USER_ID }]);
    const params = {
      db: mockDb as unknown as PostgresJsDatabase<typeof schema>,
      notificationService,
      event: { ...EVENT, creatorId: LATE_USER_ID },
      lateUserId: LATE_USER_ID,
      lateUsername: 'hiphoptobop',
    };
    await notifyAttendeeRunningLate(params);
    expect(notificationService.createMany).not.toHaveBeenCalled();
    expect(notificationService.getDiscordEmbedUrl).not.toHaveBeenCalled();
  });

  it('skips anonymous signups (null userId rows)', async () => {
    mockDb.where.mockResolvedValue([{ userId: null }, { userId: 109 }]);
    await run();
    const created = notificationService.createMany.mock.calls[0][0] as Array<{
      userId: number;
    }>;
    expect(created.map((n) => n.userId).sort()).toEqual([1, 109]);
  });
});
