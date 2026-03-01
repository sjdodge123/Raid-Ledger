import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AnalyticsService', () => {
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

  describe('getAttendanceTrends', () => {
    it('returns period and empty dataPoints when no data', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.period).toBe('30d');
      expect(result.dataPoints).toEqual([]);
      expect(result.summary.totalEvents).toBe(0);
      expect(result.summary.avgAttendanceRate).toBe(0);
      expect(result.summary.avgNoShowRate).toBe(0);
    });

    it('maps raw SQL rows to dataPoints with numeric values', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          event_date: '2026-01-15',
          attended: '8',
          no_show: '2',
          excused: '1',
          total: '11',
        },
        {
          event_date: '2026-01-22',
          attended: '10',
          no_show: '1',
          excused: '0',
          total: '11',
        },
      ]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.dataPoints).toHaveLength(2);
      expect(result.dataPoints[0]).toMatchObject({
        date: '2026-01-15',
        attended: 8,
        noShow: 2,
        excused: 1,
        total: 11,
      });
      expect(result.dataPoints[1]).toMatchObject({
        date: '2026-01-22',
        attended: 10,
        noShow: 1,
        excused: 0,
        total: 11,
      });
    });

    it('computes summary stats correctly from dataPoints', async () => {
      // 9 attended / 11 total marked = 0.82 (rounded), 2/11 = 0.18
      mockDb.execute.mockResolvedValueOnce([
        {
          event_date: '2026-01-10',
          attended: '4',
          no_show: '1',
          excused: '0',
          total: '5',
        },
        {
          event_date: '2026-01-17',
          attended: '5',
          no_show: '1',
          excused: '0',
          total: '6',
        },
      ]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.summary.totalEvents).toBe(2);
      // 9 / 11 = 0.818..., rounded to 2dp via Math.round(x*100)/100
      expect(result.summary.avgAttendanceRate).toBeCloseTo(0.82, 2);
      // 2 / 11 = 0.181..., rounded
      expect(result.summary.avgNoShowRate).toBeCloseTo(0.18, 2);
    });

    it('uses 90d period correctly (passes period through to response)', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await service.getAttendanceTrends('90d');

      expect(result.period).toBe('90d');
    });

    it('avgAttendanceRate is 0 when total is 0 (no division by zero)', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          event_date: '2026-01-01',
          attended: '0',
          no_show: '0',
          excused: '0',
          total: '0',
        },
      ]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.summary.avgAttendanceRate).toBe(0);
      expect(result.summary.avgNoShowRate).toBe(0);
    });
  });

  // ─── getUserReliability ──────────────────────────────────────────────────────

  describe('getUserReliability', () => {
    it('returns empty users list when no data', async () => {
      mockDb.execute
        .mockResolvedValueOnce([]) // rows
        .mockResolvedValueOnce([{ count: '0' }]); // count

      const result = await service.getUserReliability(20, 0);

      expect(result.users).toEqual([]);
      expect(result.totalUsers).toBe(0);
    });

    it('maps raw SQL rows to user reliability DTOs', async () => {
      mockDb.execute
        .mockResolvedValueOnce([
          {
            user_id: '42',
            username: 'Thorin',
            avatar: 'abc123',
            total_events: '10',
            attended: '8',
            no_show: '1',
            excused: '1',
          },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await service.getUserReliability(20, 0);

      expect(result.users).toHaveLength(1);
      expect(result.users[0]).toMatchObject({
        userId: 42,
        username: 'Thorin',
        avatar: 'abc123',
        totalEvents: 10,
        attended: 8,
        noShow: 1,
        excused: 1,
      });
      expect(result.totalUsers).toBe(1);
    });

    it('computes attendanceRate correctly for each user', async () => {
      mockDb.execute
        .mockResolvedValueOnce([
          {
            user_id: '1',
            username: 'Player1',
            avatar: null,
            total_events: '4',
            attended: '3',
            no_show: '1',
            excused: '0',
          },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await service.getUserReliability(20, 0);

      // 3/4 = 0.75
      expect(result.users[0].attendanceRate).toBe(0.75);
    });

    it('sets attendanceRate to 0 when totalEvents is 0', async () => {
      mockDb.execute
        .mockResolvedValueOnce([
          {
            user_id: '5',
            username: 'Ghost',
            avatar: null,
            total_events: '0',
            attended: '0',
            no_show: '0',
            excused: '0',
          },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await service.getUserReliability(20, 0);

      expect(result.users[0].attendanceRate).toBe(0);
    });

    it('handles null avatar in user row', async () => {
      mockDb.execute
        .mockResolvedValueOnce([
          {
            user_id: '7',
            username: 'NoAvatar',
            avatar: null,
            total_events: '5',
            attended: '5',
            no_show: '0',
            excused: '0',
          },
        ])
        .mockResolvedValueOnce([{ count: '1' }]);

      const result = await service.getUserReliability(20, 0);

      expect(result.users[0].avatar).toBeNull();
    });

    it('handles missing countRow gracefully (totalUsers = 0)', async () => {
      mockDb.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // empty = undefined countRow

      const result = await service.getUserReliability(20, 0);

      expect(result.totalUsers).toBe(0);
    });

    it('returns correct totalUsers from count query', async () => {
      mockDb.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: '42' }]);

      const result = await service.getUserReliability(20, 0);

      expect(result.totalUsers).toBe(42);
    });
  });

  // ─── getGameAttendance ───────────────────────────────────────────────────────

  describe('getGameAttendance', () => {
    it('returns empty games array when no data', async () => {
      mockDb.execute.mockResolvedValueOnce([]);

      const result = await service.getGameAttendance();

      expect(result.games).toEqual([]);
    });

    it('maps raw rows to game attendance DTOs', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          game_id: '3',
          game_name: 'World of Warcraft',
          cover_url: 'https://example.com/wow.jpg',
          total_events: '12',
          total_signups: '100',
          attended: '80',
          no_show: '15',
        },
      ]);

      const result = await service.getGameAttendance();

      expect(result.games).toHaveLength(1);
      expect(result.games[0]).toMatchObject({
        gameId: 3,
        gameName: 'World of Warcraft',
        coverUrl: 'https://example.com/wow.jpg',
        totalEvents: 12,
        totalSignups: 100,
      });
    });

    it('computes avgAttendanceRate and avgNoShowRate correctly', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          game_id: '1',
          game_name: 'Test Game',
          cover_url: null,
          total_events: '5',
          total_signups: '20',
          attended: '15',
          no_show: '4',
        },
      ]);

      const result = await service.getGameAttendance();

      // 15/20 = 0.75, 4/20 = 0.2
      expect(result.games[0].avgAttendanceRate).toBe(0.75);
      expect(result.games[0].avgNoShowRate).toBe(0.2);
    });

    it('sets rates to 0 when totalSignups is 0', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          game_id: '2',
          game_name: 'Empty Game',
          cover_url: null,
          total_events: '0',
          total_signups: '0',
          attended: '0',
          no_show: '0',
        },
      ]);

      const result = await service.getGameAttendance();

      expect(result.games[0].avgAttendanceRate).toBe(0);
      expect(result.games[0].avgNoShowRate).toBe(0);
    });

    it('handles null coverUrl', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          game_id: '9',
          game_name: 'No Cover',
          cover_url: null,
          total_events: '1',
          total_signups: '5',
          attended: '5',
          no_show: '0',
        },
      ]);

      const result = await service.getGameAttendance();

      expect(result.games[0].coverUrl).toBeNull();
    });

    it('returns multiple games', async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          game_id: '1',
          game_name: 'Game A',
          cover_url: null,
          total_events: '5',
          total_signups: '10',
          attended: '8',
          no_show: '2',
        },
        {
          game_id: '2',
          game_name: 'Game B',
          cover_url: null,
          total_events: '3',
          total_signups: '6',
          attended: '6',
          no_show: '0',
        },
      ]);

      const result = await service.getGameAttendance();

      expect(result.games).toHaveLength(2);
      expect(result.games[0].gameName).toBe('Game A');
      expect(result.games[1].gameName).toBe('Game B');
    });
  });

  // ─── getEventMetrics ─────────────────────────────────────────────────────────

  describe('getEventMetrics', () => {
    const mockEventRow = {
      id: 10,
      title: 'Epic Raid',
      duration: [new Date('2026-01-15T18:00:00Z'), new Date('2026-01-15T21:00:00Z')],
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

      await expect(service.getEventMetrics(999)).rejects.toThrow(NotFoundException);
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
      const eventWithoutGame = { ...mockEventRow, gameId: null, gameName: null, gameCoverUrl: null };
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
        { userId: 1, username: 'Alice', avatar: null, attendanceStatus: 'attended', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 2, username: 'Bob', avatar: null, attendanceStatus: 'attended', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 3, username: 'Carol', avatar: null, attendanceStatus: 'no_show', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 4, username: 'Dave', avatar: null, attendanceStatus: 'excused', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 5, username: 'Eve', avatar: null, attendanceStatus: null, signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
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
        { userId: 1, username: 'A', avatar: null, attendanceStatus: 'attended', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 2, username: 'B', avatar: null, attendanceStatus: 'attended', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 3, username: 'C', avatar: null, attendanceStatus: 'attended', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 4, username: 'D', avatar: null, attendanceStatus: 'no_show', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
        { userId: 5, username: 'E', avatar: null, attendanceStatus: 'excused', signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
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
        { userId: 1, username: 'A', avatar: null, attendanceStatus: null, signupStatus: 'signed_up', discordUserId: null, discordUsername: null },
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
        { id: 1, eventId: 10, userId: 1, discordUserId: 'd1', discordUsername: 'A', firstJoinAt: new Date(), lastLeaveAt: new Date(), totalDurationSec: 100, segments: [], classification: 'full' },
        { id: 2, eventId: 10, userId: 2, discordUserId: 'd2', discordUsername: 'B', firstJoinAt: new Date(), lastLeaveAt: new Date(), totalDurationSec: 100, segments: [], classification: 'full' },
        { id: 3, eventId: 10, userId: 3, discordUserId: 'd3', discordUsername: 'C', firstJoinAt: new Date(), lastLeaveAt: new Date(), totalDurationSec: 100, segments: [], classification: 'late' },
        { id: 4, eventId: 10, userId: 4, discordUserId: 'd4', discordUsername: 'D', firstJoinAt: new Date(), lastLeaveAt: new Date(), totalDurationSec: 100, segments: [], classification: 'early_leaver' },
        { id: 5, eventId: 10, userId: 5, discordUserId: 'd5', discordUsername: 'E', firstJoinAt: new Date(), lastLeaveAt: new Date(), totalDurationSec: 0, segments: [], classification: 'no_show' },
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
