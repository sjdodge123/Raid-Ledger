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
  findActiveEventsForChannel: jest.fn().mockResolvedValue([]),
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
    const mockFindActive = flushH.findActiveEventsForChannel as jest.Mock;

    beforeEach(() => {
      mockFindActive.mockReset().mockResolvedValue([]);
    });

    it('returns empty when guildId is null (no delegation)', async () => {
      mockGetGuildId.mockReturnValue(null);
      const result = await service.findActiveScheduledEvents('voice-ch-1');
      expect(result).toEqual([]);
      expect(mockFindActive).not.toHaveBeenCalled();
    });

    it('delegates to findActiveEventsForChannel with correct args', async () => {
      const bindings = [
        {
          channelId: 'voice-ch-1',
          bindingPurpose: 'game-voice-monitor',
          gameId: 42,
        },
      ];
      mockGetBindings.mockResolvedValue(bindings);
      mockGetDefaultVoice.mockResolvedValue('default-voice');
      mockFindActive.mockResolvedValue([{ eventId: 1, gameId: 42 }]);
      const result = await service.findActiveScheduledEvents('voice-ch-1');
      expect(mockFindActive).toHaveBeenCalledWith(
        mockDb,
        'voice-ch-1',
        bindings,
        expect.arrayContaining(['game-voice-monitor', 'general-lobby']),
        'default-voice',
        expect.anything(),
      );
      expect(result).toEqual([{ eventId: 1, gameId: 42 }]);
    });

    it('passes null defaultVoice when setting is absent', async () => {
      mockGetBindings.mockResolvedValue([]);
      mockGetDefaultVoice.mockResolvedValue(null);
      await service.findActiveScheduledEvents('ch-1');
      expect(mockFindActive).toHaveBeenCalledWith(
        mockDb,
        'ch-1',
        [],
        expect.any(Array),
        null,
        expect.anything(),
      );
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
