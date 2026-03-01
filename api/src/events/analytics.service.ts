import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  AttendanceTrendsPeriod,
  AttendanceTrendsResponseDto,
  UserReliabilityResponseDto,
  GameAttendanceResponseDto,
  EventMetricsResponseDto,
  VoiceClassification,
  AttendanceStatus,
} from '@raid-ledger/contract';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ─── Community-Wide: Attendance Trends ──────────────────────

  async getAttendanceTrends(
    period: AttendanceTrendsPeriod,
  ): Promise<AttendanceTrendsResponseDto> {
    const days = period === '30d' ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Get past events with signups that have attendance data
    const rows = await this.db.execute<{
      event_date: string;
      attended: string;
      no_show: string;
      excused: string;
      total: string;
      distinct_events: string;
    }>(sql`
      SELECT
        DATE(upper(e.duration)) AS event_date,
        COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
        COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show,
        COUNT(*) FILTER (WHERE es.attendance_status = 'excused') AS excused,
        COUNT(*) AS total,
        COUNT(DISTINCT e.id) AS distinct_events
      FROM events e
      JOIN event_signups es ON es.event_id = e.id
      WHERE upper(e.duration) >= ${cutoff.toISOString()}::timestamptz
        AND upper(e.duration) <= NOW()
        AND e.cancelled_at IS NULL
        AND es.attendance_status IS NOT NULL
      GROUP BY DATE(upper(e.duration))
      ORDER BY event_date ASC
    `);

    const dataPoints = rows.map((r) => ({
      date: r.event_date,
      attended: Number(r.attended),
      noShow: Number(r.no_show),
      excused: Number(r.excused),
      total: Number(r.total),
    }));

    // Compute summary
    const totalAttended = dataPoints.reduce((s, d) => s + d.attended, 0);
    const totalNoShow = dataPoints.reduce((s, d) => s + d.noShow, 0);
    const totalMarked = dataPoints.reduce((s, d) => s + d.total, 0);

    // Count distinct event IDs across all dates
    const totalEvents = rows.reduce((s, r) => s + Number(r.distinct_events), 0);

    return {
      period,
      dataPoints,
      summary: {
        avgAttendanceRate:
          totalMarked > 0
            ? Math.round((totalAttended / totalMarked) * 100) / 100
            : 0,
        avgNoShowRate:
          totalMarked > 0
            ? Math.round((totalNoShow / totalMarked) * 100) / 100
            : 0,
        totalEvents,
      },
    };
  }

  // ─── Community-Wide: User Reliability ───────────────────────

  async getUserReliability(
    limit: number,
    offset: number,
  ): Promise<UserReliabilityResponseDto> {
    const rows = await this.db.execute<{
      user_id: string;
      username: string;
      avatar: string | null;
      total_events: string;
      attended: string;
      no_show: string;
      excused: string;
    }>(sql`
      SELECT
        u.id AS user_id,
        u.username,
        u.avatar,
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
        COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show,
        COUNT(*) FILTER (WHERE es.attendance_status = 'excused') AS excused
      FROM event_signups es
      JOIN users u ON es.user_id = u.id
      JOIN events e ON es.event_id = e.id
      WHERE es.attendance_status IS NOT NULL
        AND e.cancelled_at IS NULL
        AND upper(e.duration) <= NOW()
      GROUP BY u.id, u.username, u.avatar
      ORDER BY COUNT(*) DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [countRow] = await this.db.execute<{ count: string }>(sql`
      SELECT COUNT(DISTINCT es.user_id) AS count
      FROM event_signups es
      JOIN events e ON es.event_id = e.id
      WHERE es.attendance_status IS NOT NULL
        AND e.cancelled_at IS NULL
        AND upper(e.duration) <= NOW()
        AND es.user_id IS NOT NULL
    `);

    const users = rows.map((r) => {
      const total = Number(r.total_events);
      const attended = Number(r.attended);
      return {
        userId: Number(r.user_id),
        username: r.username,
        avatar: r.avatar,
        totalEvents: total,
        attended,
        noShow: Number(r.no_show),
        excused: Number(r.excused),
        attendanceRate:
          total > 0 ? Math.round((attended / total) * 100) / 100 : 0,
      };
    });

    return {
      users,
      totalUsers: Number(countRow?.count ?? 0),
    };
  }

  // ─── Community-Wide: Per-Game Attendance ────────────────────

  async getGameAttendance(): Promise<GameAttendanceResponseDto> {
    const rows = await this.db.execute<{
      game_id: string;
      game_name: string;
      cover_url: string | null;
      total_events: string;
      total_signups: string;
      attended: string;
      no_show: string;
    }>(sql`
      SELECT
        g.id AS game_id,
        g.name AS game_name,
        g.cover_url,
        COUNT(DISTINCT e.id) AS total_events,
        COUNT(*) AS total_signups,
        COUNT(*) FILTER (WHERE es.attendance_status = 'attended') AS attended,
        COUNT(*) FILTER (WHERE es.attendance_status = 'no_show') AS no_show
      FROM events e
      JOIN games g ON e.game_id = g.id
      JOIN event_signups es ON es.event_id = e.id
      WHERE upper(e.duration) <= NOW()
        AND e.cancelled_at IS NULL
        AND es.attendance_status IS NOT NULL
      GROUP BY g.id, g.name, g.cover_url
      ORDER BY COUNT(DISTINCT e.id) DESC
    `);

    const games = rows.map((r) => {
      const totalSignups = Number(r.total_signups);
      const attended = Number(r.attended);
      const noShow = Number(r.no_show);
      return {
        gameId: Number(r.game_id),
        gameName: r.game_name,
        coverUrl: r.cover_url,
        totalEvents: Number(r.total_events),
        avgAttendanceRate:
          totalSignups > 0
            ? Math.round((attended / totalSignups) * 100) / 100
            : 0,
        avgNoShowRate:
          totalSignups > 0
            ? Math.round((noShow / totalSignups) * 100) / 100
            : 0,
        totalSignups,
      };
    });

    return { games };
  }

  // ─── Per-Event Metrics ──────────────────────────────────────

  async getEventMetrics(eventId: number): Promise<EventMetricsResponseDto> {
    // Load event with game info
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        duration: schema.events.duration,
        gameId: schema.events.gameId,
        gameName: schema.games.name,
        gameCoverUrl: schema.games.coverUrl,
      })
      .from(schema.events)
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Get all signups with user data
    const signups = await this.db
      .select({
        userId: schema.eventSignups.userId,
        username: schema.users.username,
        avatar: schema.users.avatar,
        attendanceStatus: schema.eventSignups.attendanceStatus,
        signupStatus: schema.eventSignups.status,
        discordUserId: schema.eventSignups.discordUserId,
        discordUsername: schema.eventSignups.discordUsername,
      })
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .where(eq(schema.eventSignups.eventId, eventId));

    // Get voice sessions
    const voiceSessions = await this.db
      .select()
      .from(schema.eventVoiceSessions)
      .where(eq(schema.eventVoiceSessions.eventId, eventId));

    // Build attendance summary
    const attended = signups.filter(
      (s) => s.attendanceStatus === 'attended',
    ).length;
    const noShow = signups.filter(
      (s) => s.attendanceStatus === 'no_show',
    ).length;
    const excused = signups.filter(
      (s) => s.attendanceStatus === 'excused',
    ).length;
    const total = signups.length;
    const unmarked = total - attended - noShow - excused;
    const markedTotal = attended + noShow + excused;

    // Build voice summary (null if no voice data)
    const hasVoiceData = voiceSessions.length > 0;
    const voiceSummary = hasVoiceData
      ? {
          totalTracked: voiceSessions.length,
          full: voiceSessions.filter((s) => s.classification === 'full').length,
          partial: voiceSessions.filter((s) => s.classification === 'partial')
            .length,
          late: voiceSessions.filter((s) => s.classification === 'late').length,
          earlyLeaver: voiceSessions.filter(
            (s) => s.classification === 'early_leaver',
          ).length,
          noShow: voiceSessions.filter((s) => s.classification === 'no_show')
            .length,
          sessions: voiceSessions.map((s) => ({
            id: s.id,
            eventId: s.eventId,
            userId: s.userId,
            discordUserId: s.discordUserId,
            discordUsername: s.discordUsername,
            firstJoinAt: s.firstJoinAt.toISOString(),
            lastLeaveAt: s.lastLeaveAt?.toISOString() ?? null,
            totalDurationSec: s.totalDurationSec,
            segments: (s.segments ?? []) as Array<{
              joinAt: string;
              leaveAt: string | null;
              durationSec: number;
            }>,
            classification:
              (s.classification as VoiceClassification | null) ?? null,
          })),
        }
      : null;

    // Build voice lookup by discordUserId for roster breakdown
    const voiceByDiscordId = new Map(
      voiceSessions.map((v) => [v.discordUserId, v]),
    );

    // Build roster breakdown
    const rosterBreakdown = signups.map((s) => {
      // Try to match voice session by discordUserId from the signup or from the user
      const discordId = s.discordUserId;
      const voiceSession = discordId
        ? voiceByDiscordId.get(discordId)
        : undefined;

      return {
        userId: s.userId ?? 0,
        username: s.username ?? s.discordUsername ?? 'Unknown',
        avatar: s.avatar ?? null,
        attendanceStatus:
          (s.attendanceStatus as AttendanceStatus | null) ?? null,
        voiceClassification: voiceSession
          ? ((voiceSession.classification as VoiceClassification | null) ??
            null)
          : null,
        voiceDurationSec: voiceSession ? voiceSession.totalDurationSec : null,
        signupStatus: s.signupStatus ?? null,
      };
    });

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
      attendanceSummary: {
        attended,
        noShow,
        excused,
        unmarked,
        total,
        attendanceRate:
          markedTotal > 0
            ? Math.round((attended / markedTotal) * 100) / 100
            : 0,
      },
      voiceSummary,
      rosterBreakdown,
    };
  }
}
