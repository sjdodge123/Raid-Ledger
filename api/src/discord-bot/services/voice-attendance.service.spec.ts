import { Test, TestingModule } from '@nestjs/testing';
import {
  VoiceAttendanceService,
  classifyVoiceSession,
} from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('VoiceAttendanceService', () => {
  let service: VoiceAttendanceService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();

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

    service = module.get(VoiceAttendanceService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('in-memory session tracking', () => {
    it('creates a new session on first join', () => {
      service.handleJoin(1, 'discord-100', 'TestUser', 42);
      // Idempotent — second join should not throw
      service.handleJoin(1, 'discord-100', 'TestUser', 42);
      service.handleLeave(1, 'discord-100');
    });

    it('handles leave for unknown session gracefully', () => {
      service.handleLeave(999, 'discord-unknown');
    });

    it('handles rejoin after leave (creates new segment)', () => {
      service.handleJoin(1, 'discord-200', 'Player2', null);
      service.handleLeave(1, 'discord-200');
      service.handleJoin(1, 'discord-200', 'Player2', null);
      service.handleLeave(1, 'discord-200');
    });

    it('does not process leave when already inactive', () => {
      service.handleJoin(1, 'discord-300', 'Player3', null);
      service.handleLeave(1, 'discord-300');
      service.handleLeave(1, 'discord-300'); // Second leave is no-op
    });
  });

  describe('getVoiceSessions', () => {
    it('returns sessions formatted as DTOs', async () => {
      const now = new Date();
      const mockSessions = [
        {
          id: 'uuid-1',
          eventId: 1,
          userId: 42,
          discordUserId: 'discord-100',
          discordUsername: 'Player1',
          firstJoinAt: now,
          lastLeaveAt: now,
          totalDurationSec: 3600,
          segments: [
            {
              joinAt: now.toISOString(),
              leaveAt: now.toISOString(),
              durationSec: 3600,
            },
          ],
          classification: 'full',
        },
      ];

      mockDb.where.mockResolvedValueOnce(mockSessions);

      const result = await service.getVoiceSessions(1);

      expect(result).toMatchObject({
        eventId: 1,
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            eventId: expect.any(Number),
            discordUserId: expect.any(String),
            totalDurationSec: expect.any(Number),
            classification: 'full',
          }),
        ]),
      });
    });
  });

  describe('getVoiceAttendanceSummary', () => {
    it('returns summary with correct counts', async () => {
      const now = new Date();
      const makeSess = (classification: string | null) => ({
        id: `uuid-${Math.random()}`,
        eventId: 1,
        userId: null,
        discordUserId: `discord-${Math.random()}`,
        discordUsername: 'Player',
        firstJoinAt: now,
        lastLeaveAt: now,
        totalDurationSec: 1000,
        segments: [],
        classification,
      });

      mockDb.where.mockResolvedValueOnce([
        makeSess('full'),
        makeSess('full'),
        makeSess('partial'),
        makeSess('late'),
        makeSess('early_leaver'),
        makeSess('no_show'),
        makeSess(null),
      ]);

      const result = await service.getVoiceAttendanceSummary(1);

      expect(result).toMatchObject({
        eventId: 1,
        totalTracked: 7,
        full: 2,
        partial: 1,
        late: 1,
        earlyLeaver: 1,
        noShow: 1,
        unclassified: 1,
      });
    });
  });
});

describe('classifyVoiceSession (pure function)', () => {
  // Helper: create event timing
  function eventWindow(durationHours: number) {
    const start = new Date('2026-02-28T20:00:00Z');
    const end = new Date(start.getTime() + durationHours * 3600_000);
    const durationSec = durationHours * 3600;
    const graceMs = 5 * 60 * 1000; // 5 minutes
    return { start, end, durationSec, graceMs };
  }

  it('classifies full attendance (>= 80% presence)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.9), // 90%
        firstJoinAt: start,
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('full');
  });

  it('classifies full at exactly 80% boundary', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.8), // exactly 80%
        firstJoinAt: start,
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('full');
  });

  it('classifies no_show (< 2 minutes total presence)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: 60, // 1 minute
        firstJoinAt: new Date(start.getTime() + 30 * 60_000),
        lastLeaveAt: new Date(start.getTime() + 31 * 60_000),
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('no_show');
  });

  it('classifies no_show for zero duration', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: 0,
        firstJoinAt: start,
        lastLeaveAt: start,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('no_show');
  });

  it('classifies late arrival (joined after grace window, >= 20% presence)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.5), // 50%
        firstJoinAt: new Date(start.getTime() + 15 * 60_000), // 15 min late
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('late');
  });

  it('classifies late even with high presence (joined after grace)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.85), // 85%
        firstJoinAt: new Date(start.getTime() + 6 * 60_000), // 6 min late (past 5 min grace)
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('late');
  });

  it('does not classify as late if within grace window', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.9), // 90%
        firstJoinAt: new Date(start.getTime() + 4 * 60_000), // 4 min late (within grace)
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('full');
  });

  it('classifies early_leaver (left > 5min before end, 20-79% presence)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.5), // 50%
        firstJoinAt: start,
        lastLeaveAt: new Date(end.getTime() - 30 * 60_000), // left 30 min early
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('early_leaver');
  });

  it('does not classify as early_leaver if left within 5 min of end', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.5), // 50%
        firstJoinAt: start,
        lastLeaveAt: new Date(end.getTime() - 2 * 60_000), // left 2 min before end
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('partial'); // Not early_leaver
  });

  it('classifies partial (20-79% presence, on time, no early leave)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.5), // 50%
        firstJoinAt: start,
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('partial');
  });

  it('classifies partial at exactly 20% boundary', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.2), // exactly 20%
        firstJoinAt: start,
        lastLeaveAt: end,
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('partial');
  });

  it('handles null lastLeaveAt (still in channel)', () => {
    const { start, end, durationSec, graceMs } = eventWindow(2);

    const result = classifyVoiceSession(
      {
        totalDurationSec: Math.floor(durationSec * 0.9),
        firstJoinAt: start,
        lastLeaveAt: null, // still in channel
      },
      start,
      end,
      durationSec,
      graceMs,
    );

    expect(result).toBe('full');
  });
});
