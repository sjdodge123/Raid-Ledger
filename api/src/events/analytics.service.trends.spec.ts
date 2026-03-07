import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

let service: AnalyticsService;
let mockDb: Record<string, jest.Mock>;

async function setupEach() {
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
}

// ─── getAttendanceTrends ────────────────────────────────────────────────────

async function testTrendsEmptyData() {
  mockDb.execute.mockResolvedValueOnce([]);
  const result = await service.getAttendanceTrends('30d');
  expect(result.period).toBe('30d');
  expect(result.dataPoints).toEqual([]);
  expect(result.summary.totalEvents).toBe(0);
  expect(result.summary.avgAttendanceRate).toBe(0);
  expect(result.summary.avgNoShowRate).toBe(0);
}

async function testTrendsMapsRows() {
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
}

async function testTrendsSummary() {
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
  expect(result.summary.avgAttendanceRate).toBeCloseTo(0.82, 2);
  expect(result.summary.avgNoShowRate).toBeCloseTo(0.18, 2);
}

async function testTrendsMultipleEventsPerDate() {
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
}

async function testTrends90d() {
  mockDb.execute.mockResolvedValueOnce([]);
  const result = await service.getAttendanceTrends('90d');
  expect(result.period).toBe('90d');
}

async function testTrendsNoDivisionByZero() {
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
}

// ─── getUserReliability ─────────────────────────────────────────────────────

async function testReliabilityEmpty() {
  mockDb.execute
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ count: '0' }]);
  const result = await service.getUserReliability(20, 0);
  expect(result.users).toEqual([]);
  expect(result.totalUsers).toBe(0);
}

async function testReliabilityMapsRows() {
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
}

async function testReliabilityRate() {
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
  expect(result.users[0].attendanceRate).toBe(0.75);
}

async function testReliabilityZeroEvents() {
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
}

async function testReliabilityNullAvatar() {
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
}

async function testReliabilityMissingCountRow() {
  mockDb.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  const result = await service.getUserReliability(20, 0);
  expect(result.totalUsers).toBe(0);
}

async function testReliabilityTotalUsers() {
  mockDb.execute
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ count: '42' }]);
  const result = await service.getUserReliability(20, 0);
  expect(result.totalUsers).toBe(42);
}

// ─── getGameAttendance ──────────────────────────────────────────────────────

async function testGameEmpty() {
  mockDb.execute.mockResolvedValueOnce([]);
  const result = await service.getGameAttendance();
  expect(result.games).toEqual([]);
}

async function testGameMapsRows() {
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
}

async function testGameRates() {
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
  expect(result.games[0].avgAttendanceRate).toBe(0.75);
  expect(result.games[0].avgNoShowRate).toBe(0.2);
}

async function testGameZeroSignups() {
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
}

async function testGameNullCover() {
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
}

async function testGameMultiple() {
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
}

beforeEach(() => setupEach());

describe('AnalyticsService — getAttendanceTrends', () => {
  it('returns empty data when no rows', () => testTrendsEmptyData());
  it('maps raw SQL rows to dataPoints', () => testTrendsMapsRows());
  it('computes summary stats correctly', () => testTrendsSummary());
  it('counts multiple events per date', () =>
    testTrendsMultipleEventsPerDate());
  it('uses 90d period correctly', () => testTrends90d());
  it('no division by zero when total is 0', () => testTrendsNoDivisionByZero());
});

describe('AnalyticsService — getUserReliability', () => {
  it('returns empty when no data', () => testReliabilityEmpty());
  it('maps raw SQL rows to DTOs', () => testReliabilityMapsRows());
  it('computes attendanceRate correctly', () => testReliabilityRate());
  it('sets rate to 0 when totalEvents is 0', () => testReliabilityZeroEvents());
  it('handles null avatar', () => testReliabilityNullAvatar());
  it('handles missing countRow gracefully', () =>
    testReliabilityMissingCountRow());
  it('returns correct totalUsers from count query', () =>
    testReliabilityTotalUsers());
});

describe('AnalyticsService — getGameAttendance', () => {
  it('returns empty when no data', () => testGameEmpty());
  it('maps raw rows to DTOs', () => testGameMapsRows());
  it('computes rates correctly', () => testGameRates());
  it('sets rates to 0 when totalSignups is 0', () => testGameZeroSignups());
  it('handles null coverUrl', () => testGameNullCover());
  it('returns multiple games', () => testGameMultiple());
});
