import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AnalyticsService — metrics', () => {
  let service: AnalyticsService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = {};

    const chainMethods = [
      'select',
      'from',
      'where',
      'orderBy',
      'limit',
      'offset',
      'leftJoin',
      'innerJoin',
      'insert',
      'values',
      'returning',
      'update',
      'set',
      'delete',
      'groupBy',
      'execute',
    ];

    for (const m of chainMethods) {
      mockDb[m] = jest.fn().mockReturnThis();
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  // ─── getAttendanceTrends ─────────────────────────────────────────────────────

  describe('getEventMetrics', () => {
    const mockEventRow = {
      id: 10,
      title: 'Epic Raid',
      duration: [
        new Date('2026-01-15T18:00:00Z'),
        new Date('2026-01-15T21:00:00Z'),
      ],
      gameId: 3,
      gameName: 'World of Warcraft',
      gameCoverUrl: 'https://example.com/wow.jpg',
    };

    const buildSelectChain = (resolvedValue: unknown[]) => ({
      from: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(resolvedValue),
          }),
        }),
      }),
    });

    it('throws NotFoundException when event does not exist', async () => {
      mockDb.select.mockReturnValueOnce(buildSelectChain([]));

      await expect(service.getEventMetrics(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns event metrics with correct eventId and title', async () => {
      // 1. Event query
      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      // 2. Signups query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      // 3. Voice sessions query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.eventId).toBe(10);
      expect(result.title).toBe('Epic Raid');
    });

    it('includes game info when event has a game', async () => {
      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.game).toMatchObject({
        id: 3,
        name: 'World of Warcraft',
        coverUrl: 'https://example.com/wow.jpg',
      });
    });

    it('sets game to null when event has no gameId', async () => {
      const eventWithoutGame = {
        ...mockEventRow,
        gameId: null,
        gameName: null,
        gameCoverUrl: null,
      };
      mockDb.select.mockReturnValueOnce(buildSelectChain([eventWithoutGame]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.game).toBeNull();
    });

    it('computes attendanceSummary counts correctly', async () => {
      const mockSignups = [
        {
          userId: 1,
          username: 'Alice',
          avatar: null,
          attendanceStatus: 'attended',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 2,
          username: 'Bob',
          avatar: null,
          attendanceStatus: 'attended',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 3,
          username: 'Carol',
          avatar: null,
          attendanceStatus: 'no_show',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 4,
          username: 'Dave',
          avatar: null,
          attendanceStatus: 'excused',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 5,
          username: 'Eve',
          avatar: null,
          attendanceStatus: null,
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockSignups),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.attendanceSummary).toMatchObject({
        attended: 2,
        noShow: 1,
        excused: 1,
        unmarked: 1,
        total: 5,
      });
    });

    it('computes attendanceRate correctly', async () => {
      // 3 attended, 1 no_show, 1 excused = 3/5 marked = 0.6
      const mockSignups = [
        {
          userId: 1,
          username: 'A',
          avatar: null,
          attendanceStatus: 'attended',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 2,
          username: 'B',
          avatar: null,
          attendanceStatus: 'attended',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 3,
          username: 'C',
          avatar: null,
          attendanceStatus: 'attended',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 4,
          username: 'D',
          avatar: null,
          attendanceStatus: 'no_show',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
        {
          userId: 5,
          username: 'E',
          avatar: null,
          attendanceStatus: 'excused',
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockSignups),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.attendanceSummary.attendanceRate).toBe(0.6);
    });

    it('sets attendanceRate to 0 when no marked signups', async () => {
      const allUnmarked = [
        {
          userId: 1,
          username: 'A',
          avatar: null,
          attendanceStatus: null,
          signupStatus: 'signed_up',
          discordUserId: null,
          discordUsername: null,
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(allUnmarked),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.attendanceSummary.attendanceRate).toBe(0);
    });

    it('returns voiceSummary as null when no voice sessions', async () => {
      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.voiceSummary).toBeNull();
    });

    it('returns populated voiceSummary when voice sessions exist', async () => {
      const voiceSessions = [
        {
          id: 1,
          eventId: 10,
          userId: 1,
          discordUserId: 'discord-1',
          discordUsername: 'Alice#1234',
          firstJoinAt: new Date('2026-01-15T18:05:00Z'),
          lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
          totalDurationSec: 10500,
          segments: [],
          classification: 'full',
        },
        {
          id: 2,
          eventId: 10,
          userId: 2,
          discordUserId: 'discord-2',
          discordUsername: 'Bob#5678',
          firstJoinAt: new Date('2026-01-15T18:30:00Z'),
          lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
          totalDurationSec: 9000,
          segments: [],
          classification: 'partial',
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(voiceSessions),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.voiceSummary).not.toBeNull();
      expect(result.voiceSummary!.totalTracked).toBe(2);
      expect(result.voiceSummary!.full).toBe(1);
      expect(result.voiceSummary!.partial).toBe(1);
      expect(result.voiceSummary!.late).toBe(0);
      expect(result.voiceSummary!.earlyLeaver).toBe(0);
      expect(result.voiceSummary!.noShow).toBe(0);
      expect(result.voiceSummary!.sessions).toHaveLength(2);
    });

    it('handles voice session with null lastLeaveAt', async () => {
      const voiceSessions = [
        {
          id: 1,
          eventId: 10,
          userId: 1,
          discordUserId: 'discord-1',
          discordUsername: 'Ongoing#1234',
          firstJoinAt: new Date('2026-01-15T18:05:00Z'),
          lastLeaveAt: null,
          totalDurationSec: 0,
          segments: [],
          classification: 'partial',
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(voiceSessions),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.voiceSummary!.sessions[0].lastLeaveAt).toBeNull();
    });

    it('builds rosterBreakdown with voice data matched by discordUserId', async () => {
      const mockSignup = {
        userId: 1,
        username: 'Alice',
        avatar: null,
        attendanceStatus: 'attended',
        signupStatus: 'signed_up',
        discordUserId: 'discord-1',
        discordUsername: 'Alice#1234',
      };

      const voiceSession = {
        id: 1,
        eventId: 10,
        userId: 1,
        discordUserId: 'discord-1',
        discordUsername: 'Alice#1234',
        firstJoinAt: new Date('2026-01-15T18:05:00Z'),
        lastLeaveAt: new Date('2026-01-15T21:00:00Z'),
        totalDurationSec: 10500,
        segments: [],
        classification: 'full',
      };

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([voiceSession]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.rosterBreakdown).toHaveLength(1);
      expect(result.rosterBreakdown[0]).toMatchObject({
        userId: 1,
        username: 'Alice',
        attendanceStatus: 'attended',
        voiceClassification: 'full',
        voiceDurationSec: 10500,
      });
    });

    it('sets voiceClassification to null for signups without matching voice session', async () => {
      const mockSignup = {
        userId: 2,
        username: 'Bob',
        avatar: null,
        attendanceStatus: null,
        signupStatus: 'signed_up',
        discordUserId: null,
        discordUsername: null,
      };

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.rosterBreakdown[0].voiceClassification).toBeNull();
      expect(result.rosterBreakdown[0].voiceDurationSec).toBeNull();
    });

    it('uses discordUsername as fallback when username is null', async () => {
      const mockSignup = {
        userId: null,
        username: null,
        avatar: null,
        attendanceStatus: null,
        signupStatus: null,
        discordUserId: 'discord-999',
        discordUsername: 'Anonymous#9999',
      };

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.rosterBreakdown[0].username).toBe('Anonymous#9999');
    });

    it('uses "Unknown" as final fallback username', async () => {
      const mockSignup = {
        userId: null,
        username: null,
        avatar: null,
        attendanceStatus: null,
        signupStatus: null,
        discordUserId: null,
        discordUsername: null,
      };

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mockSignup]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.rosterBreakdown[0].username).toBe('Unknown');
    });

    it('serializes startTime and endTime as ISO strings', async () => {
      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.startTime).toBe('2026-01-15T18:00:00.000Z');
      expect(result.endTime).toBe('2026-01-15T21:00:00.000Z');
    });

    it('counts voice classifications correctly across multiple sessions', async () => {
      const voiceSessions = [
        {
          id: 1,
          eventId: 10,
          userId: 1,
          discordUserId: 'd1',
          discordUsername: 'A',
          firstJoinAt: new Date(),
          lastLeaveAt: new Date(),
          totalDurationSec: 100,
          segments: [],
          classification: 'full',
        },
        {
          id: 2,
          eventId: 10,
          userId: 2,
          discordUserId: 'd2',
          discordUsername: 'B',
          firstJoinAt: new Date(),
          lastLeaveAt: new Date(),
          totalDurationSec: 100,
          segments: [],
          classification: 'full',
        },
        {
          id: 3,
          eventId: 10,
          userId: 3,
          discordUserId: 'd3',
          discordUsername: 'C',
          firstJoinAt: new Date(),
          lastLeaveAt: new Date(),
          totalDurationSec: 100,
          segments: [],
          classification: 'late',
        },
        {
          id: 4,
          eventId: 10,
          userId: 4,
          discordUserId: 'd4',
          discordUsername: 'D',
          firstJoinAt: new Date(),
          lastLeaveAt: new Date(),
          totalDurationSec: 100,
          segments: [],
          classification: 'early_leaver',
        },
        {
          id: 5,
          eventId: 10,
          userId: 5,
          discordUserId: 'd5',
          discordUsername: 'E',
          firstJoinAt: new Date(),
          lastLeaveAt: new Date(),
          totalDurationSec: 0,
          segments: [],
          classification: 'no_show',
        },
      ];

      mockDb.select.mockReturnValueOnce(buildSelectChain([mockEventRow]));
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      });
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(voiceSessions),
        }),
      });

      const result = await service.getEventMetrics(10);

      expect(result.voiceSummary!.full).toBe(2);
      expect(result.voiceSummary!.late).toBe(1);
      expect(result.voiceSummary!.earlyLeaver).toBe(1);
      expect(result.voiceSummary!.noShow).toBe(1);
      expect(result.voiceSummary!.partial).toBe(0);
    });
  });
});
