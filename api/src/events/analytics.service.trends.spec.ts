import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('AnalyticsService — trends', () => {
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
          distinct_events: '1',
        },
        {
          event_date: '2026-01-22',
          attended: '10',
          no_show: '1',
          excused: '0',
          total: '11',
          distinct_events: '1',
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
          distinct_events: '1',
        },
        {
          event_date: '2026-01-17',
          attended: '5',
          no_show: '1',
          excused: '0',
          total: '6',
          distinct_events: '1',
        },
      ]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.summary.totalEvents).toBe(2);
      // 9 / 11 = 0.818..., rounded to 2dp via Math.round(x*100)/100
      expect(result.summary.avgAttendanceRate).toBeCloseTo(0.82, 2);
      // 2 / 11 = 0.181..., rounded
      expect(result.summary.avgNoShowRate).toBeCloseTo(0.18, 2);
    });

    it('counts multiple events on the same date correctly', async () => {
      // Two events on the same date should count as 2, not 1
      mockDb.execute.mockResolvedValueOnce([
        {
          event_date: '2026-01-10',
          attended: '10',
          no_show: '2',
          excused: '0',
          total: '12',
          distinct_events: '2',
        },
      ]);

      const result = await service.getAttendanceTrends('30d');

      expect(result.summary.totalEvents).toBe(2);
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
          distinct_events: '1',
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
      mockDb.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // empty = undefined countRow

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

});
