import {
  VoiceAttendanceService,
  classifyVoiceSession,
} from './voice-attendance.service';
import type { MockDb } from '../../common/testing/drizzle-mock';
import * as flushH from './voice-attendance-flush.helpers';
import {
  setupVoiceAttendanceTestModule,
  eventWindow,
} from './voice-attendance.service.spec-helpers';

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
    const mocks = await setupVoiceAttendanceTestModule();
    service = mocks.service;
    mockDb = mocks.mockDb;
    mockGetBindings = mocks.mockGetBindings;
    mockGetGuildId = mocks.mockGetGuildId;
    mockGetDefaultVoice = mocks.mockGetDefaultVoice;
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
    async function testReturnsSessionsFormattedAsDtos() {
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
      await testReturnsSessionsFormattedAsDtos();
    });
  });

  describe('getVoiceAttendanceSummary', () => {
    async function testReturnsSummaryWithCorrectCounts() {
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
      await testReturnsSummaryWithCorrectCounts();
    });
  });

  describe('findActiveScheduledEvents', () => {
    const mockQueryActiveEvents = flushH.queryActiveEvents as jest.Mock;

    beforeEach(() => {
      mockQueryActiveEvents.mockReset();
    });

    describe('no binding / fallback paths', () => {
      it('returns empty when guildId is null', async () => {
        mockGetGuildId.mockReturnValue(null);
        const result = await service.findActiveScheduledEvents('voice-ch-1');
        expect(result).toEqual([]);
        expect(mockQueryActiveEvents).not.toHaveBeenCalled();
      });

      it('falls back to default voice channel', async () => {
        mockGetBindings.mockResolvedValue([]);
        mockGetDefaultVoice.mockResolvedValue('default-voice');
        mockQueryActiveEvents.mockResolvedValue([
          { eventId: 20, gameId: null },
        ]);
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
        const result =
          await service.findActiveScheduledEvents('unknown-channel');
        expect(result).toEqual([]);
        expect(mockQueryActiveEvents).not.toHaveBeenCalled();
      });

      it('binding with unknown purpose is ignored (ROK-785)', async () => {
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
    });

    describe('game-voice-monitor binding', () => {
      it('queries with gameId filter', async () => {
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

      it('queries all events when gameId is null', async () => {
        mockGetBindings.mockResolvedValue([
          {
            channelId: 'voice-ch-no-game',
            bindingPurpose: 'game-voice-monitor',
            gameId: null,
          },
        ]);
        mockQueryActiveEvents.mockResolvedValue([
          { eventId: 30, gameId: null },
        ]);
        const result =
          await service.findActiveScheduledEvents('voice-ch-no-game');
        expect(mockQueryActiveEvents).toHaveBeenCalledWith(
          mockDb,
          null,
          expect.any(Date),
        );
        expect(result).toEqual([{ eventId: 30, gameId: null }]);
      });

      it('still filters by gameId (regression guard, ROK-785)', async () => {
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
    });

    describe('general-lobby binding', () => {
      it('queries all events (ROK-785)', async () => {
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
        const result =
          await service.findActiveScheduledEvents('voice-ch-lobby');
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

      it('ignores non-null gameId and still queries with null filter (ROK-785)', async () => {
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
        expect(mockQueryActiveEvents).toHaveBeenCalledWith(
          mockDb,
          null,
          expect.any(Date),
        );
        expect(result).toHaveLength(2);
      });

      it('returns multiple active events for different games (ROK-785)', async () => {
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
    });

    describe('binding precedence', () => {
      it('uses first matching binding when both purposes exist (ROK-785)', async () => {
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
        expect(mockQueryActiveEvents).toHaveBeenCalledTimes(1);
        expect(mockQueryActiveEvents).toHaveBeenCalledWith(
          mockDb,
          7,
          expect.any(Date),
        );
        expect(result).toEqual([{ eventId: 50, gameId: 7 }]);
      });

      it('does not consult default voice when a binding matches', async () => {
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
        expect(mockGetDefaultVoice).not.toHaveBeenCalled();
      });
    });
  });
});

describe('classifyVoiceSession (pure function)', () => {
  describe('full attendance', () => {
    it('classifies >= 80% presence as full', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.9),
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

    it('classifies exactly 80% boundary as full', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.8),
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

    it('does not classify as late if within grace window', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.9),
          firstJoinAt: new Date(start.getTime() + 4 * 60_000),
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );
      expect(result).toBe('full');
    });

    it('handles null lastLeaveAt (still in channel)', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.9),
          firstJoinAt: start,
          lastLeaveAt: null,
        },
        start,
        end,
        durationSec,
        graceMs,
      );
      expect(result).toBe('full');
    });
  });

  describe('no_show', () => {
    it('classifies < 2 minutes total presence', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: 60,
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

    it('classifies zero duration', () => {
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
  });

  describe('late arrival', () => {
    it('classifies joined after grace window with >= 20% presence', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: new Date(start.getTime() + 15 * 60_000),
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
          totalDurationSec: Math.floor(durationSec * 0.85),
          firstJoinAt: new Date(start.getTime() + 6 * 60_000),
          lastLeaveAt: end,
        },
        start,
        end,
        durationSec,
        graceMs,
      );
      expect(result).toBe('late');
    });
  });

  describe('early_leaver', () => {
    it('classifies left > 5min before end with 20-79% presence', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: start,
          lastLeaveAt: new Date(end.getTime() - 30 * 60_000),
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
          totalDurationSec: Math.floor(durationSec * 0.5),
          firstJoinAt: start,
          lastLeaveAt: new Date(end.getTime() - 2 * 60_000),
        },
        start,
        end,
        durationSec,
        graceMs,
      );
      expect(result).toBe('partial');
    });
  });

  describe('partial', () => {
    it('classifies 20-79% presence, on time, no early leave', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.5),
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

    it('classifies exactly 20% boundary as partial', () => {
      const { start, end, durationSec, graceMs } = eventWindow(2);
      const result = classifyVoiceSession(
        {
          totalDurationSec: Math.floor(durationSec * 0.2),
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
  });
});
