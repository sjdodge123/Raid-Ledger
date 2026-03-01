/**
 * voice-attendance.roster.spec.ts
 *
 * Adversarial tests for ROK-530: getActiveRoster() and getActiveCount()
 * methods added to VoiceAttendanceService.
 *
 * Focus areas:
 *  1. getActiveRoster() — shape mapping from InMemorySession to AdHocParticipantDto
 *  2. getActiveRoster() — active vs inactive sessions (leftAt field)
 *  3. getActiveRoster() — duration calculation for active sessions
 *  4. getActiveRoster() — empty roster, multi-event isolation
 *  5. getActiveRoster() — null userId, null avatar fields
 *  6. getActiveCount() — count accuracy, empty event
 */
import { Test, TestingModule } from '@nestjs/testing';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildService(): Promise<{
  service: VoiceAttendanceService;
  mockDb: MockDb;
}> {
  const mockDb = createDrizzleMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoiceAttendanceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: { get: jest.fn().mockResolvedValue('5') },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_: string, fn: () => Promise<void>) => fn()),
        },
      },
      {
        provide: ChannelBindingsService,
        useValue: { getBindings: jest.fn().mockResolvedValue([]) },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getClient: jest.fn(), getGuildId: jest.fn() },
      },
    ],
  }).compile();

  const service = module.get(VoiceAttendanceService);
  return { service, mockDb };
}

// ─── getActiveRoster() ────────────────────────────────────────────────────────

describe('VoiceAttendanceService.getActiveRoster (ROK-530)', () => {
  let service: VoiceAttendanceService;

  beforeEach(async () => {
    jest.useFakeTimers();
    ({ service } = await buildService());
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  // ── empty roster ───────────────────────────────────────────────────────────

  it('returns empty participants array and zero activeCount when no sessions exist', () => {
    const result = service.getActiveRoster(1);

    expect(result).toMatchObject({
      eventId: 1,
      participants: [],
      activeCount: 0,
    });
  });

  it('returns empty roster for an eventId with no sessions even when other events have sessions', () => {
    service.handleJoin(2, 'discord-other', 'OtherUser', null);

    const result = service.getActiveRoster(99);

    expect(result.participants).toHaveLength(0);
    expect(result.activeCount).toBe(0);
  });

  // ── DTO shape ─────────────────────────────────────────────────────────────

  it('maps an active session to AdHocParticipantDto shape', () => {
    jest.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    service.handleJoin(10, 'discord-A', 'PlayerA', 42);

    const result = service.getActiveRoster(10);

    expect(result.participants).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({
      id: expect.any(String),
      eventId: 10,
      userId: 42,
      discordUserId: 'discord-A',
      discordUsername: 'PlayerA',
      discordAvatarHash: null,
      joinedAt: expect.any(String),
      leftAt: null,
      totalDurationSeconds: expect.any(Number),
      sessionCount: expect.any(Number),
    });
  });

  it('always sets discordAvatarHash to null (avatar hash is not tracked in roster)', () => {
    service.handleJoin(10, 'discord-B', 'PlayerB', 1);
    service.handleLeave(10, 'discord-B');

    const result = service.getActiveRoster(10);

    expect(result.participants[0].discordAvatarHash).toBeNull();
  });

  // ── active vs inactive (leftAt) ───────────────────────────────────────────

  it('active user has leftAt === null', () => {
    service.handleJoin(10, 'discord-active', 'ActiveUser', 1);

    const result = service.getActiveRoster(10);
    const p = result.participants.find(
      (p) => p.discordUserId === 'discord-active',
    );

    expect(p?.leftAt).toBeNull();
  });

  it('user who left has leftAt set to the leave time ISO string', () => {
    jest.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    service.handleJoin(10, 'discord-left', 'LeftUser', 1);

    jest.setSystemTime(new Date('2026-03-01T18:30:00Z'));
    service.handleLeave(10, 'discord-left');

    const result = service.getActiveRoster(10);
    const p = result.participants.find(
      (p) => p.discordUserId === 'discord-left',
    );

    expect(p?.leftAt).toBe('2026-03-01T18:30:00.000Z');
  });

  it('activeCount reflects only users with leftAt === null', () => {
    service.handleJoin(10, 'discord-still-here', 'StillHere', 1);
    service.handleJoin(10, 'discord-gone', 'Gone', 2);
    service.handleLeave(10, 'discord-gone');

    const result = service.getActiveRoster(10);

    expect(result.activeCount).toBe(1);
    expect(result.participants).toHaveLength(2);
  });

  // ── duration calculation ──────────────────────────────────────────────────

  it('includes elapsed time from active segment in totalDurationSeconds', () => {
    jest.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    service.handleJoin(10, 'discord-dur', 'DurUser', null);

    // Advance 90 seconds — user still in channel
    jest.setSystemTime(new Date('2026-03-01T18:01:30Z'));

    const result = service.getActiveRoster(10);
    const p = result.participants[0];

    expect(p.totalDurationSeconds).toBeGreaterThanOrEqual(90);
  });

  it('totalDurationSeconds for an inactive user equals recorded totalDurationSec', () => {
    jest.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    service.handleJoin(10, 'discord-fin', 'FinUser', null);

    jest.setSystemTime(new Date('2026-03-01T18:01:00Z')); // 60s
    service.handleLeave(10, 'discord-fin');

    const result = service.getActiveRoster(10);
    const p = result.participants[0];

    expect(p.totalDurationSeconds).toBe(60);
  });

  it('accumulates duration across multiple join/leave segments for an active user', () => {
    jest.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    service.handleJoin(10, 'discord-seg', 'SegUser', null);

    jest.setSystemTime(new Date('2026-03-01T18:01:00Z')); // +60s
    service.handleLeave(10, 'discord-seg');

    jest.setSystemTime(new Date('2026-03-01T18:02:00Z'));
    service.handleJoin(10, 'discord-seg', 'SegUser', null); // rejoin

    // 30 seconds into second segment
    jest.setSystemTime(new Date('2026-03-01T18:02:30Z'));

    const result = service.getActiveRoster(10);
    const p = result.participants.find(
      (p) => p.discordUserId === 'discord-seg',
    );

    // First segment = 60s, current active = 30s → total >= 90s
    expect(p?.totalDurationSeconds).toBeGreaterThanOrEqual(90);
  });

  // ── sessionCount ──────────────────────────────────────────────────────────

  it('sessionCount equals number of segments (1 on first join)', () => {
    service.handleJoin(10, 'discord-sc1', 'SC1', null);

    const result = service.getActiveRoster(10);
    expect(result.participants[0].sessionCount).toBe(1);
  });

  it('sessionCount increments after rejoin', () => {
    service.handleJoin(10, 'discord-sc2', 'SC2', null);
    service.handleLeave(10, 'discord-sc2');
    service.handleJoin(10, 'discord-sc2', 'SC2', null); // rejoin

    const result = service.getActiveRoster(10);
    expect(result.participants[0].sessionCount).toBe(2);
  });

  // ── null userId (unlinked discord user) ───────────────────────────────────

  it('userId is null when user is not linked to a Raid Ledger account', () => {
    service.handleJoin(10, 'discord-unlinked', 'Guest', null);

    const result = service.getActiveRoster(10);
    expect(result.participants[0].userId).toBeNull();
  });

  // ── multi-event isolation ─────────────────────────────────────────────────

  it('only returns sessions for the requested eventId', () => {
    service.handleJoin(10, 'discord-X', 'EventX', 1);
    service.handleJoin(20, 'discord-Y', 'EventY', 2);
    service.handleJoin(20, 'discord-Z', 'EventZ', 3);

    const result10 = service.getActiveRoster(10);
    const result20 = service.getActiveRoster(20);

    expect(result10.participants).toHaveLength(1);
    expect(result10.participants[0].discordUserId).toBe('discord-X');

    expect(result20.participants).toHaveLength(2);
    expect(result20.eventId).toBe(20);
  });

  // ── joinedAt field ────────────────────────────────────────────────────────

  it('joinedAt reflects the firstJoinAt time of the session', () => {
    const joinTime = new Date('2026-03-01T18:00:00Z');
    jest.setSystemTime(joinTime);
    service.handleJoin(10, 'discord-join', 'JoinUser', null);

    const result = service.getActiveRoster(10);
    expect(result.participants[0].joinedAt).toBe(joinTime.toISOString());
  });

  // ── id field ─────────────────────────────────────────────────────────────

  it('participant id matches discordUserId', () => {
    service.handleJoin(10, 'discord-id-check', 'IDCheckUser', null);

    const result = service.getActiveRoster(10);
    expect(result.participants[0].id).toBe('discord-id-check');
  });
});

// ─── getActiveCount() ─────────────────────────────────────────────────────────

describe('VoiceAttendanceService.getActiveCount (ROK-530)', () => {
  let service: VoiceAttendanceService;

  beforeEach(async () => {
    jest.useFakeTimers();
    ({ service } = await buildService());
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('returns 0 when no sessions exist for the event', () => {
    expect(service.getActiveCount(99)).toBe(0);
  });

  it('returns 0 when all users have left', () => {
    service.handleJoin(5, 'discord-one', 'One', null);
    service.handleJoin(5, 'discord-two', 'Two', null);
    service.handleLeave(5, 'discord-one');
    service.handleLeave(5, 'discord-two');

    expect(service.getActiveCount(5)).toBe(0);
  });

  it('returns correct count when some users are active and some have left', () => {
    service.handleJoin(5, 'discord-stay', 'Stay', null);
    service.handleJoin(5, 'discord-go', 'Go', null);
    service.handleLeave(5, 'discord-go');

    expect(service.getActiveCount(5)).toBe(1);
  });

  it('returns count for exactly requested eventId, not other events', () => {
    service.handleJoin(5, 'discord-A', 'A', null);
    service.handleJoin(5, 'discord-B', 'B', null);
    service.handleJoin(6, 'discord-C', 'C', null); // Different event

    expect(service.getActiveCount(5)).toBe(2);
    expect(service.getActiveCount(6)).toBe(1);
  });

  it('increments when user rejoins after leaving', () => {
    service.handleJoin(5, 'discord-rejoin', 'Rejoin', null);
    service.handleLeave(5, 'discord-rejoin');

    expect(service.getActiveCount(5)).toBe(0);

    service.handleJoin(5, 'discord-rejoin', 'Rejoin', null);

    expect(service.getActiveCount(5)).toBe(1);
  });

  it('matches the activeCount field in getActiveRoster response', () => {
    service.handleJoin(5, 'discord-match-A', 'MatchA', null);
    service.handleJoin(5, 'discord-match-B', 'MatchB', null);
    service.handleLeave(5, 'discord-match-B');

    const count = service.getActiveCount(5);
    const roster = service.getActiveRoster(5);

    expect(count).toBe(roster.activeCount);
  });
});
