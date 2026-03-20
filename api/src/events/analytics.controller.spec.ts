import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { OperatorGuard } from '../auth/operator.guard';
import { AuthGuard } from '@nestjs/passport';

const mockAttendanceTrends = {
  period: '30d' as const,
  dataPoints: [
    { date: '2026-01-15', attended: 8, noShow: 2, excused: 1, total: 11 },
  ],
  summary: {
    avgAttendanceRate: 0.73,
    avgNoShowRate: 0.18,
    totalEvents: 1,
  },
};

const mockUserReliability = {
  users: [
    {
      userId: 1,
      username: 'Thorin',
      avatar: null,
      totalEvents: 10,
      attended: 8,
      noShow: 1,
      excused: 1,
      attendanceRate: 0.8,
    },
  ],
  totalUsers: 1,
};

const mockGameAttendance = {
  games: [
    {
      gameId: 1,
      gameName: 'World of Warcraft',
      coverUrl: null,
      totalEvents: 5,
      avgAttendanceRate: 0.75,
      avgNoShowRate: 0.1,
      totalSignups: 20,
    },
  ],
};

let controller: AnalyticsController;
let mockService: Partial<AnalyticsService>;

async function setupEach() {
  mockService = {
    getAttendanceTrends: jest.fn().mockResolvedValue(mockAttendanceTrends),
    getUserReliability: jest.fn().mockResolvedValue(mockUserReliability),
    getGameAttendance: jest.fn().mockResolvedValue(mockGameAttendance),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [AnalyticsController],
    providers: [{ provide: AnalyticsService, useValue: mockService }],
  })
    .overrideGuard(AuthGuard('jwt'))
    .useValue({ canActivate: () => true })
    .overrideGuard(OperatorGuard)
    .useValue({ canActivate: () => true })
    .compile();

  controller = module.get<AnalyticsController>(AnalyticsController);
}

function verifyGuardsApplied() {
  const guards = Reflect.getMetadata('__guards__', AnalyticsController);
  expect(guards).toBeDefined();
  expect(guards.length).toBe(2);
}

async function testTrendsDefaultsPeriod() {
  await controller.getAttendanceTrends({});
  expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('30d');
}

async function testTrendsPasses90d() {
  await controller.getAttendanceTrends({ period: '90d' });
  expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('90d');
}

async function testTrendsInvalidPeriod() {
  await expect(
    controller.getAttendanceTrends({ period: 'invalid' }),
  ).rejects.toThrow(BadRequestException);
}

async function testTrendsReturnsData() {
  const result = await controller.getAttendanceTrends({ period: '30d' });
  expect(result).toMatchObject({
    period: '30d',
    dataPoints: expect.any(Array),
    summary: expect.any(Object),
  });
}

async function testReliabilityDefaults() {
  await controller.getUserReliability({});
  expect(mockService.getUserReliability).toHaveBeenCalledWith(20, 0);
}

async function testReliabilityPassesParams() {
  await controller.getUserReliability({ limit: '10', offset: '50' });
  expect(mockService.getUserReliability).toHaveBeenCalledWith(10, 50);
}

async function testReliabilityLimitExceeds100() {
  await expect(controller.getUserReliability({ limit: '200' })).rejects.toThrow(
    BadRequestException,
  );
}

async function testReliabilityNegativeOffset() {
  await expect(controller.getUserReliability({ offset: '-1' })).rejects.toThrow(
    BadRequestException,
  );
}

async function testReliabilityNonNumericLimit() {
  await expect(controller.getUserReliability({ limit: 'abc' })).rejects.toThrow(
    BadRequestException,
  );
}

async function testReliabilityReturnsData() {
  const result = await controller.getUserReliability({});
  expect(result).toMatchObject({
    users: expect.any(Array),
    totalUsers: expect.any(Number),
  });
}

async function testGameCallsService() {
  await controller.getGameAttendance();
  expect(mockService.getGameAttendance).toHaveBeenCalledTimes(1);
}

async function testGameReturnsData() {
  const result = await controller.getGameAttendance();
  expect(result).toMatchObject({ games: expect.any(Array) });
}

beforeEach(() => setupEach());

describe('AnalyticsController — guard metadata', () => {
  it('has AuthGuard(jwt) and OperatorGuard at class level', () =>
    verifyGuardsApplied());
});

describe('AnalyticsController — getAttendanceTrends', () => {
  it('defaults to 30d period', () => testTrendsDefaultsPeriod());
  it('passes 90d period to service', () => testTrendsPasses90d());
  it('throws BadRequestException for invalid period', () =>
    testTrendsInvalidPeriod());
  it('returns data from service', () => testTrendsReturnsData());
});

describe('AnalyticsController — getUserReliability', () => {
  it('defaults to limit=20, offset=0', () => testReliabilityDefaults());
  it('passes limit and offset from query', () => testReliabilityPassesParams());
  it('throws for limit exceeding 100', () => testReliabilityLimitExceeds100());
  it('throws for negative offset', () => testReliabilityNegativeOffset());
  it('throws for non-numeric limit', () => testReliabilityNonNumericLimit());
  it('returns data from service', () => testReliabilityReturnsData());
});

describe('AnalyticsController — getGameAttendance', () => {
  it('calls service without parameters', () => testGameCallsService());
  it('returns data from service', () => testGameReturnsData());
});
