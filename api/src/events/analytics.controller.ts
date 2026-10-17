import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OperatorGuard } from '../auth/operator.guard';
import { AnalyticsService } from './analytics.service';
import {
  AttendanceTrendsQuerySchema,
  UserReliabilityQuerySchema,
} from '@raid-ledger/contract';
import type {
  AttendanceTrendsResponseDto,
  UserReliabilityResponseDto,
  GameAttendanceResponseDto,
} from '@raid-ledger/contract';
import { handleValidationError } from '../common/validation.util';

/**
 * Community-wide analytics endpoints (ROK-491).
 * All endpoints require operator or admin role.
 */
@Controller('analytics')
@UseGuards(AuthGuard('jwt'), OperatorGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Get attendance trends over time (line chart data).
   */
  @Get('attendance')
  async getAttendanceTrends(
    @Query() query: Record<string, string>,
  ): Promise<AttendanceTrendsResponseDto> {
    try {
      const dto = AttendanceTrendsQuerySchema.parse(query);
      return this.analyticsService.getAttendanceTrends(dto.period);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get per-user reliability stats (leaderboard data).
   */
  @Get('attendance/users')
  async getUserReliability(
    @Query() query: Record<string, string>,
  ): Promise<UserReliabilityResponseDto> {
    try {
      const dto = UserReliabilityQuerySchema.parse(query);
      return this.analyticsService.getUserReliability(dto.limit, dto.offset);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get per-game attendance breakdown (bar chart data).
   */
  @Get('attendance/games')
  async getGameAttendance(): Promise<GameAttendanceResponseDto> {
    return this.analyticsService.getGameAttendance();
  }
}
