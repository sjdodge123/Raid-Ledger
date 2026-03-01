import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';
import {
  AttendanceTrendsQuerySchema,
  UserReliabilityQuerySchema,
} from '@raid-ledger/contract';
import type {
  AttendanceTrendsResponseDto,
  UserReliabilityResponseDto,
  GameAttendanceResponseDto,
  UserRole,
} from '@raid-ledger/contract';
import { ZodError } from 'zod';

interface AuthenticatedRequest {
  user: {
    id: number;
    role: UserRole;
  };
}

/** Helper: check if user has operator-or-above role */
function isOperatorOrAdmin(role: UserRole): boolean {
  return role === 'operator' || role === 'admin';
}

/**
 * Handle Zod validation errors by converting to BadRequestException.
 */
function handleValidationError(error: unknown): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const zodError = error as ZodError;
    throw new BadRequestException({
      message: 'Validation failed',
      errors: zodError.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  throw error;
}

/**
 * Community-wide analytics endpoints (ROK-491).
 * All endpoints require operator or admin role.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Get attendance trends over time (line chart data).
   * Operator/admin only.
   */
  @Get('attendance')
  @UseGuards(AuthGuard('jwt'))
  async getAttendanceTrends(
    @Query() query: Record<string, string>,
    @Request() req: AuthenticatedRequest,
  ): Promise<AttendanceTrendsResponseDto> {
    if (!isOperatorOrAdmin(req.user.role)) {
      throw new ForbiddenException(
        'Only operators and admins can view analytics',
      );
    }
    try {
      const dto = AttendanceTrendsQuerySchema.parse(query);
      return this.analyticsService.getAttendanceTrends(dto.period);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get per-user reliability stats (leaderboard data).
   * Operator/admin only.
   */
  @Get('attendance/users')
  @UseGuards(AuthGuard('jwt'))
  async getUserReliability(
    @Query() query: Record<string, string>,
    @Request() req: AuthenticatedRequest,
  ): Promise<UserReliabilityResponseDto> {
    if (!isOperatorOrAdmin(req.user.role)) {
      throw new ForbiddenException(
        'Only operators and admins can view analytics',
      );
    }
    try {
      const dto = UserReliabilityQuerySchema.parse(query);
      return this.analyticsService.getUserReliability(dto.limit, dto.offset);
    } catch (error) {
      handleValidationError(error);
    }
  }

  /**
   * Get per-game attendance breakdown (bar chart data).
   * Operator/admin only.
   */
  @Get('attendance/games')
  @UseGuards(AuthGuard('jwt'))
  async getGameAttendance(
    @Request() req: AuthenticatedRequest,
  ): Promise<GameAttendanceResponseDto> {
    if (!isOperatorOrAdmin(req.user.role)) {
      throw new ForbiddenException(
        'Only operators and admins can view analytics',
      );
    }
    return this.analyticsService.getGameAttendance();
  }
}
