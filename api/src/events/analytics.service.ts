import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  queryAttendanceTrends,
  buildTrendsSummary,
  queryUserReliability,
  mapReliabilityUsers,
  queryGameAttendance,
} from './analytics-queries.helpers';
import {
  queryEventMetricsData,
  buildVoiceSummary,
  buildRosterBreakdown,
  buildAttendanceSummary,
} from './analytics-metrics.helpers';
import type {
  AttendanceTrendsPeriod,
  AttendanceTrendsResponseDto,
  UserReliabilityResponseDto,
  GameAttendanceResponseDto,
  EventMetricsResponseDto,
} from '@raid-ledger/contract';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getAttendanceTrends(
    period: AttendanceTrendsPeriod,
  ): Promise<AttendanceTrendsResponseDto> {
    const days = period === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const rows = await queryAttendanceTrends(this.db, cutoff);
    return buildTrendsSummary(rows, period);
  }

  async getUserReliability(
    limit: number,
    offset: number,
  ): Promise<UserReliabilityResponseDto> {
    const { rows, totalUsers } = await queryUserReliability(
      this.db,
      limit,
      offset,
    );
    return { users: mapReliabilityUsers(rows), totalUsers };
  }

  async getGameAttendance(): Promise<GameAttendanceResponseDto> {
    return queryGameAttendance(this.db);
  }

  async getEventMetrics(eventId: number): Promise<EventMetricsResponseDto> {
    const { event, signups, voiceSessions } = await queryEventMetricsData(
      this.db,
      eventId,
    );
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    return {
      eventId,
      title: event.title,
      startTime: event.duration[0].toISOString(),
      endTime: event.duration[1].toISOString(),
      game: event.gameId
        ? {
            id: event.gameId,
            name: event.gameName ?? 'Unknown',
            coverUrl: event.gameCoverUrl ?? null,
          }
        : null,
      attendanceSummary: buildAttendanceSummary(signups),
      voiceSummary: buildVoiceSummary(voiceSessions),
      rosterBreakdown: buildRosterBreakdown(signups, voiceSessions),
    };
  }
}
