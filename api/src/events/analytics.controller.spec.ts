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

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let mockService: Partial<AnalyticsService>;

  beforeEach(async () => {
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
  });

  // ─── getAttendanceTrends ─────────────────────────────────────────────────────

  describe('getAttendanceTrends', () => {
    it('throws ForbiddenException for member role', async () => {
      await expect(
        controller.getAttendanceTrends({}, makeReq('member')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows operator role', async () => {
      const result = await controller.getAttendanceTrends(
        {},
        makeReq('operator'),
      );
      expect(result).toEqual(mockAttendanceTrends);
    });

    it('allows admin role', async () => {
      const result = await controller.getAttendanceTrends({}, makeReq('admin'));
      expect(result).toEqual(mockAttendanceTrends);
    });

    it('defaults to 30d period when no period param provided', async () => {
      await controller.getAttendanceTrends({}, makeReq('operator'));
      expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('30d');
    });

    it('passes 90d period to service when specified', async () => {
      await controller.getAttendanceTrends(
        { period: '90d' },
        makeReq('operator'),
      );
      expect(mockService.getAttendanceTrends).toHaveBeenCalledWith('90d');
    });

    it('throws BadRequestException for invalid period value', async () => {
      await expect(
        controller.getAttendanceTrends(
          { period: 'invalid' },
          makeReq('operator'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns data from service', async () => {
      const result = await controller.getAttendanceTrends(
        { period: '30d' },
        makeReq('admin'),
      );
      expect(result).toMatchObject({
        period: '30d',
        dataPoints: expect.any(Array),
        summary: expect.any(Object),
      });
    });
  });

  // ─── getUserReliability ──────────────────────────────────────────────────────

  describe('getUserReliability', () => {
    it('throws ForbiddenException for member role', async () => {
      await expect(
        controller.getUserReliability({}, makeReq('member')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows operator role', async () => {
      const result = await controller.getUserReliability(
        {},
        makeReq('operator'),
      );
      expect(result).toEqual(mockUserReliability);
    });

    it('allows admin role', async () => {
      const result = await controller.getUserReliability({}, makeReq('admin'));
      expect(result).toEqual(mockUserReliability);
    });

    it('defaults to limit=20 and offset=0 when no query params', async () => {
      await controller.getUserReliability({}, makeReq('operator'));
      expect(mockService.getUserReliability).toHaveBeenCalledWith(20, 0);
    });

    it('passes limit and offset from query to service', async () => {
      await controller.getUserReliability(
        { limit: '10', offset: '50' },
        makeReq('operator'),
      );
      expect(mockService.getUserReliability).toHaveBeenCalledWith(10, 50);
    });

    it('throws BadRequestException for limit exceeding 100', async () => {
      await expect(
        controller.getUserReliability({ limit: '200' }, makeReq('operator')),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for negative offset', async () => {
      await expect(
        controller.getUserReliability({ offset: '-1' }, makeReq('operator')),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for non-numeric limit', async () => {
      await expect(
        controller.getUserReliability({ limit: 'abc' }, makeReq('operator')),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns data from service', async () => {
      const result = await controller.getUserReliability({}, makeReq('admin'));
      expect(result).toMatchObject({
        users: expect.any(Array),
        totalUsers: expect.any(Number),
      });
    });
  });

  // ─── getGameAttendance ───────────────────────────────────────────────────────

  describe('getGameAttendance', () => {
    it('throws ForbiddenException for member role', async () => {
      await expect(
        controller.getGameAttendance(makeReq('member')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows operator role', async () => {
      const result = await controller.getGameAttendance(makeReq('operator'));
      expect(result).toEqual(mockGameAttendance);
    });

    it('allows admin role', async () => {
      const result = await controller.getGameAttendance(makeReq('admin'));
      expect(result).toEqual(mockGameAttendance);
    });

    it('calls service without parameters', async () => {
      await controller.getGameAttendance(makeReq('operator'));
      expect(mockService.getGameAttendance).toHaveBeenCalledTimes(1);
    });

    it('returns data from service', async () => {
      const result = await controller.getGameAttendance(makeReq('admin'));
      expect(result).toMatchObject({
        games: expect.any(Array),
      });
    });
  });

  // ─── isOperatorOrAdmin helper (via controller behavior) ─────────────────────

  describe('role enforcement', () => {
    it('rejects all three endpoints for member role consistently', async () => {
      const memberReq = makeReq('member');

      await expect(
        controller.getAttendanceTrends({}, memberReq),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.getUserReliability({}, memberReq),
      ).rejects.toThrow(ForbiddenException);
      await expect(controller.getGameAttendance(memberReq)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
