import { Test, TestingModule } from '@nestjs/testing';
import {
  VoiceAttendanceService,
  classifyVoiceSession,
} from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as flushH from './voice-attendance-flush.helpers';

jest.mock('./voice-attendance-flush.helpers', () => ({
  ...jest.requireActual('./voice-attendance-flush.helpers'),
  queryActiveEvents: jest.fn().mockResolvedValue([]),
}));

describe('VoiceAttendanceService', () => {
  let service: VoiceAttendanceService;
  let mockDb: MockDb;
  let mockGetBindings: jest.Mock;
  let mockGetGuildId: jest.Mock;
  let mockGetDefaultVoice: jest.Mock;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockGetBindings = jest.fn().mockResolvedValue([]);
    mockGetGuildId = jest.fn().mockReturnValue('guild-1');
    mockGetDefaultVoice = jest.fn().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceAttendanceService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn().mockResolvedValue('5'),
            getDiscordBotDefaultVoiceChannel: mockGetDefaultVoice,
          },
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
          useValue: { getBindings: mockGetBindings },
        },
        {
          provide: DiscordBotClientService,
          useValue: { getClient: jest.fn(), getGuildId: mockGetGuildId },
        },
        {
          provide: ChannelResolverService,
          useValue: { resolveVoiceChannelForEvent: jest.fn() },
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
    async function testReturnssessionsformattedasdtos() {
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
    }

    it('returns sessions formatted as DTOs', async () => {
      await testReturnssessionsformattedasdtos();
    });
  });

  describe('getVoiceAttendanceSummary', () => {
    async function testReturnssummarywithcorrectcounts() {
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
    }

    it('returns summary with correct counts', async () => {
      await testReturnssummarywithcorrectcounts();
    });
  });

  describe('findActiveScheduledEvents', () => {
    const mockQueryActiveEvents = flushH.queryActiveEvents as jest.Mock;

    beforeEach(() => {
      mockQueryActiveEvents.mockReset();
    });

    it('returns empty when guildId is null', async () => {
      mockGetGuildId.mockReturnValue(null);

      const result = await service.findActiveScheduledEvents('voice-ch-1');

      expect(result).toEqual([]);
      expect(mockQueryActiveEvents).not.toHaveBeenCalled();
    });

    it('queries with gameId for game-voice-monitor binding', async () => {
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-1',
          bindingPurpose: 'game-voice-monitor',
          gameId: 42,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 1, gameId: 42 }]);

      const result = await service.findActiveScheduledEvents('voice-ch-1');

      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        42,
        expect.any(Date),
      );
      expect(result).toEqual([{ eventId: 1, gameId: 42 }]);
    });

    it('queries all events for general-lobby binding (ROK-785)', async () => {
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-lobby',
          bindingPurpose: 'general-lobby',
          gameId: null,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([
        { eventId: 10, gameId: null },
        { eventId: 11, gameId: 5 },
      ]);

      const result = await service.findActiveScheduledEvents('voice-ch-lobby');

      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        null,
        expect.any(Date),
      );
      expect(result).toEqual([
        { eventId: 10, gameId: null },
        { eventId: 11, gameId: 5 },
      ]);
    });

    it('falls back to default voice channel', async () => {
      mockGetBindings.mockResolvedValue([]);
      mockGetDefaultVoice.mockResolvedValue('default-voice');
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 20, gameId: null }]);

      const result = await service.findActiveScheduledEvents('default-voice');

      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        null,
        expect.any(Date),
      );
      expect(result).toEqual([{ eventId: 20, gameId: null }]);
    });

    it('returns empty for unrecognized channel', async () => {
      mockGetBindings.mockResolvedValue([]);
      mockGetDefaultVoice.mockResolvedValue('default-voice');

      const result = await service.findActiveScheduledEvents('unknown-channel');

      expect(result).toEqual([]);
      expect(mockQueryActiveEvents).not.toHaveBeenCalled();
    });

    it('queries all events for game-voice-monitor with null gameId', async () => {
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-no-game',
          bindingPurpose: 'game-voice-monitor',
          gameId: null,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 30, gameId: null }]);

      const result =
        await service.findActiveScheduledEvents('voice-ch-no-game');

      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        null,
        expect.any(Date),
      );
      expect(result).toEqual([{ eventId: 30, gameId: null }]);
    });

    it('uses first matching binding when channel has both game-voice-monitor and general-lobby (ROK-785)', async () => {
      // Channel has two bindings — game-voice-monitor listed first.
      // The fix uses Array.find(), so the first match wins.
      // This test guards that find() returns one binding, not both.
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-dual',
          bindingPurpose: 'game-voice-monitor',
          gameId: 7,
        },
        {
          channelId: 'voice-ch-dual',
          bindingPurpose: 'general-lobby',
          gameId: null,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 50, gameId: 7 }]);

      const result = await service.findActiveScheduledEvents('voice-ch-dual');

      // Only one call to queryActiveEvents — the first matching binding wins.
      expect(mockQueryActiveEvents).toHaveBeenCalledTimes(1);
      // game-voice-monitor is first, so gameId=7 filter is applied.
      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        7,
        expect.any(Date),
      );
      expect(result).toEqual([{ eventId: 50, gameId: 7 }]);
    });

    it('general-lobby with non-null gameId still queries with null filter (ROK-785)', async () => {
      // Unusual edge: general-lobby has a gameId set (shouldn't happen in normal
      // config, but the fix must still pass null to queryActiveEvents for
      // general-lobby regardless of what gameId is stored).
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-lobby-game',
          bindingPurpose: 'general-lobby',
          gameId: 99,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([
        { eventId: 60, gameId: null },
        { eventId: 61, gameId: 99 },
      ]);

      const result = await service.findActiveScheduledEvents(
        'voice-ch-lobby-game',
      );

      // general-lobby always passes null — never gameId — even if gameId is set.
      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        null,
        expect.any(Date),
      );
      expect(result).toHaveLength(2);
    });

    it('binding with unknown purpose is ignored even if channelId matches (ROK-785 regression guard)', async () => {
      // A binding exists for the channel but has a purpose that is not in
      // VOICE_BINDING_PURPOSES. It must be treated as no binding found.
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-wrong-purpose',
          bindingPurpose: 'text-announce',
          gameId: null,
        },
      ]);
      mockGetDefaultVoice.mockResolvedValue(null);

      const result = await service.findActiveScheduledEvents(
        'voice-ch-wrong-purpose',
      );

      expect(result).toEqual([]);
      expect(mockQueryActiveEvents).not.toHaveBeenCalled();
    });

    it('general-lobby returns multiple active events for different games (ROK-785)', async () => {
      // Verifies the general-lobby path surfaces all active events regardless
      // of their gameId, supporting cross-game lobby channels.
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-multilobby',
          bindingPurpose: 'general-lobby',
          gameId: null,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([
        { eventId: 70, gameId: 1 },
        { eventId: 71, gameId: 2 },
        { eventId: 72, gameId: null },
      ]);

      const result = await service.findActiveScheduledEvents(
        'voice-ch-multilobby',
      );

      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          { eventId: 70, gameId: 1 },
          { eventId: 71, gameId: 2 },
          { eventId: 72, gameId: null },
        ]),
      );
    });

    it('game-voice-monitor path still filters by gameId (regression guard, ROK-785)', async () => {
      // Ensure the ROK-785 fix did not break the pre-existing game-voice-monitor
      // behaviour: it must still pass the gameId to narrow results.
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-wow',
          bindingPurpose: 'game-voice-monitor',
          gameId: 3,
        },
      ]);
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 80, gameId: 3 }]);

      await service.findActiveScheduledEvents('voice-ch-wow');

      expect(mockQueryActiveEvents).toHaveBeenCalledWith(
        mockDb,
        3,
        expect.any(Date),
      );
    });

    it('default voice channel is not consulted when a matching binding exists', async () => {
      // Even if a default voice channel is configured, a binding match should
      // short-circuit before ever calling getDiscordBotDefaultVoiceChannel.
      mockGetBindings.mockResolvedValue([
        {
          channelId: 'voice-ch-bound',
          bindingPurpose: 'game-voice-monitor',
          gameId: 5,
        },
      ]);
      mockGetDefaultVoice.mockResolvedValue('voice-ch-bound');
      mockQueryActiveEvents.mockResolvedValue([{ eventId: 90, gameId: 5 }]);

      await service.findActiveScheduledEvents('voice-ch-bound');

      // getDiscordBotDefaultVoiceChannel must not be called — binding matched first.
      expect(mockGetDefaultVoice).not.toHaveBeenCalled();
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
