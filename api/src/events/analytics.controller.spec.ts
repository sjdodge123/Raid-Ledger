import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import type { UserRole } from '@raid-ledger/contract';

interface AuthenticatedRequest {
  user: { id: number; role: UserRole };
}

const makeReq = (role: UserRole): AuthenticatedRequest => ({
  user: { id: 1, role },
});

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
  }).compile();

  controller = module.get<AnalyticsController>(AnalyticsController);
}

async function testTrendsForbiddenForMember() {
  await expect(
    controller.getAttendanceTrends({}, makeReq('member')),
  ).rejects.toThrow(ForbiddenException);
}

async function testTrendsAllowsOperator() {
  const result = await controller.getAttendanceTrends({}, makeReq('operator'));
  expect(result).toEqual(mockAttendanceTrends);
}

async function testTrendsAllowsAdmin() {
  const result = await controller.getAttendanceTrends({}, makeReq('admin'));
  expect(result).toEqual(mockAttendanceTrends);
}

async function testTrendsDefaultsPeriod() {
  await controller.getAttendanceTrends({}, makeReq('operator'));
  expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('30d');
}

async function testTrendsPasses90d() {
  await controller.getAttendanceTrends({ period: '90d' }, makeReq('operator'));
  expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('90d');
}

async function testTrendsInvalidPeriod() {
  await expect(
    controller.getAttendanceTrends({ period: 'invalid' }, makeReq('operator')),
  ).rejects.toThrow(BadRequestException);
}

async function testTrendsReturnsData() {
  const result = await controller.getAttendanceTrends(
    { period: '30d' },
    makeReq('admin'),
  );
  expect(result).toMatchObject({
    period: '30d',
    dataPoints: expect.any(Array),
    summary: expect.any(Object),
  });
}

async function testReliabilityForbiddenForMember() {
  await expect(
    controller.getUserReliability({}, makeReq('member')),
  ).rejects.toThrow(ForbiddenException);
}

async function testReliabilityAllowsOperator() {
  const result = await controller.getUserReliability({}, makeReq('operator'));
  expect(result).toEqual(mockUserReliability);
}

async function testReliabilityAllowsAdmin() {
  const result = await controller.getUserReliability({}, makeReq('admin'));
  expect(result).toEqual(mockUserReliability);
}

async function testReliabilityDefaults() {
  await controller.getUserReliability({}, makeReq('operator'));
  expect(mockService.getUserReliability).toHaveBeenCalledWith(20, 0);
}

async function testReliabilityPassesParams() {
  await controller.getUserReliability(
    { limit: '10', offset: '50' },
    makeReq('operator'),
  );
  expect(mockService.getUserReliability).toHaveBeenCalledWith(10, 50);
}

async function testReliabilityLimitExceeds100() {
  await expect(
    controller.getUserReliability({ limit: '200' }, makeReq('operator')),
  ).rejects.toThrow(BadRequestException);
}

async function testReliabilityNegativeOffset() {
  await expect(
    controller.getUserReliability({ offset: '-1' }, makeReq('operator')),
  ).rejects.toThrow(BadRequestException);
}

async function testReliabilityNonNumericLimit() {
  await expect(
    controller.getUserReliability({ limit: 'abc' }, makeReq('operator')),
  ).rejects.toThrow(BadRequestException);
}

async function testReliabilityReturnsData() {
  const result = await controller.getUserReliability({}, makeReq('admin'));
  expect(result).toMatchObject({
    users: expect.any(Array),
    totalUsers: expect.any(Number),
  });
}

async function testGameForbiddenForMember() {
  await expect(controller.getGameAttendance(makeReq('member'))).rejects.toThrow(
    ForbiddenException,
  );
}

async function testGameAllowsOperator() {
  const result = await controller.getGameAttendance(makeReq('operator'));
  expect(result).toEqual(mockGameAttendance);
}

async function testGameAllowsAdmin() {
  const result = await controller.getGameAttendance(makeReq('admin'));
  expect(result).toEqual(mockGameAttendance);
}

async function testGameCallsService() {
  await controller.getGameAttendance(makeReq('operator'));
  expect(mockService.getGameAttendance).toHaveBeenCalledTimes(1);
}

async function testGameReturnsData() {
  const result = await controller.getGameAttendance(makeReq('admin'));
  expect(result).toMatchObject({ games: expect.any(Array) });
}

async function testRoleEnforcement() {
  const memberReq = makeReq('member');
  await expect(controller.getAttendanceTrends({}, memberReq)).rejects.toThrow(
    ForbiddenException,
  );
  await expect(controller.getUserReliability({}, memberReq)).rejects.toThrow(
    ForbiddenException,
  );
  await expect(controller.getGameAttendance(memberReq)).rejects.toThrow(
    ForbiddenException,
  );
}

beforeEach(() => setupEach());

describe('AnalyticsController — getAttendanceTrends', () => {
  it('throws ForbiddenException for member', () =>
    testTrendsForbiddenForMember());
  it('allows operator role', () => testTrendsAllowsOperator());
  it('allows admin role', () => testTrendsAllowsAdmin());
  it('defaults to 30d period', () => testTrendsDefaultsPeriod());
  it('passes 90d period to service', () => testTrendsPasses90d());
  it('throws BadRequestException for invalid period', () =>
    testTrendsInvalidPeriod());
  it('returns data from service', () => testTrendsReturnsData());
});

describe('AnalyticsController — getUserReliability', () => {
  it('throws ForbiddenException for member', () =>
    testReliabilityForbiddenForMember());
  it('allows operator role', () => testReliabilityAllowsOperator());
  it('allows admin role', () => testReliabilityAllowsAdmin());
  it('defaults to limit=20, offset=0', () => testReliabilityDefaults());
  it('passes limit and offset from query', () => testReliabilityPassesParams());
  it('throws for limit exceeding 100', () => testReliabilityLimitExceeds100());
  it('throws for negative offset', () => testReliabilityNegativeOffset());
  it('throws for non-numeric limit', () => testReliabilityNonNumericLimit());
  it('returns data from service', () => testReliabilityReturnsData());
});

describe('AnalyticsController — getGameAttendance', () => {
  it('throws ForbiddenException for member', () =>
    testGameForbiddenForMember());
  it('allows operator role', () => testGameAllowsOperator());
  it('allows admin role', () => testGameAllowsAdmin());
  it('calls service without parameters', () => testGameCallsService());
  it('returns data from service', () => testGameReturnsData());
});

describe('AnalyticsController — role enforcement', () => {
  it('rejects all endpoints for member consistently', () =>
    testRoleEnforcement());
});
