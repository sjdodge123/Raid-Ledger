import { z } from 'zod';
import { VoiceClassificationEnum, EventVoiceSessionSchema, VoiceAttendanceSummarySchema } from './voice-attendance.schema.js';
import { AttendanceStatusSchema } from './signups.schema.js';

// ============================================================
// Event Analytics Schemas (ROK-491)
// ============================================================

// ─── Query Schemas ──────────────────────────────────────────

/** Period param for attendance trends */
export const AttendanceTrendsPeriodSchema = z.enum(['30d', '90d']);
export type AttendanceTrendsPeriod = z.infer<typeof AttendanceTrendsPeriodSchema>;

/** Query params for attendance trends */
export const AttendanceTrendsQuerySchema = z.object({
  period: AttendanceTrendsPeriodSchema.default('30d'),
});
export type AttendanceTrendsQuery = z.infer<typeof AttendanceTrendsQuerySchema>;

/** Query params for user reliability */
export const UserReliabilityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type UserReliabilityQuery = z.infer<typeof UserReliabilityQuerySchema>;

// ─── Community-Wide Analytics Responses ─────────────────────

/** Single data point for attendance trends line chart */
export const AttendanceTrendPointSchema = z.object({
  date: z.string(),
  attended: z.number(),
  noShow: z.number(),
  excused: z.number(),
  total: z.number(),
});
export type AttendanceTrendPoint = z.infer<typeof AttendanceTrendPointSchema>;

/** Response for GET /analytics/attendance */
export const AttendanceTrendsResponseSchema = z.object({
  period: AttendanceTrendsPeriodSchema,
  dataPoints: z.array(AttendanceTrendPointSchema),
  summary: z.object({
    avgAttendanceRate: z.number(),
    avgNoShowRate: z.number(),
    totalEvents: z.number(),
  }),
});
export type AttendanceTrendsResponseDto = z.infer<typeof AttendanceTrendsResponseSchema>;

/** Single user's reliability stats */
export const UserReliabilitySchema = z.object({
  userId: z.number(),
  username: z.string(),
  avatar: z.string().nullable(),
  totalEvents: z.number(),
  attended: z.number(),
  noShow: z.number(),
  excused: z.number(),
  attendanceRate: z.number(),
});
export type UserReliabilityDto = z.infer<typeof UserReliabilitySchema>;

/** Response for GET /analytics/attendance/users */
export const UserReliabilityResponseSchema = z.object({
  users: z.array(UserReliabilitySchema),
  totalUsers: z.number(),
});
export type UserReliabilityResponseDto = z.infer<typeof UserReliabilityResponseSchema>;

/** Per-game attendance breakdown */
export const GameAttendanceSchema = z.object({
  gameId: z.number(),
  gameName: z.string(),
  coverUrl: z.string().nullable(),
  totalEvents: z.number(),
  avgAttendanceRate: z.number(),
  avgNoShowRate: z.number(),
  totalSignups: z.number(),
});
export type GameAttendanceDto = z.infer<typeof GameAttendanceSchema>;

/** Response for GET /analytics/attendance/games */
export const GameAttendanceResponseSchema = z.object({
  games: z.array(GameAttendanceSchema),
});
export type GameAttendanceResponseDto = z.infer<typeof GameAttendanceResponseSchema>;

/** Repeat no-show offender */
export const NoShowPatternSchema = z.object({
  userId: z.number(),
  username: z.string(),
  avatar: z.string().nullable(),
  noShowCount: z.number(),
  totalEvents: z.number(),
  noShowRate: z.number(),
});
export type NoShowPatternDto = z.infer<typeof NoShowPatternSchema>;

/** Day-of-week no-show distribution */
export const DayOfWeekNoShowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  noShowCount: z.number(),
  totalSignups: z.number(),
  noShowRate: z.number(),
});
export type DayOfWeekNoShowDto = z.infer<typeof DayOfWeekNoShowSchema>;

/** No-show patterns response (bundled in analytics/attendance endpoint) */
export const NoShowPatternsResponseSchema = z.object({
  repeatOffenders: z.array(NoShowPatternSchema),
  dayOfWeekDistribution: z.array(DayOfWeekNoShowSchema),
});
export type NoShowPatternsResponseDto = z.infer<typeof NoShowPatternsResponseSchema>;

// ─── Per-Event Metrics Response ─────────────────────────────

/** Attendance summary for a single event's metrics donut chart */
export const EventAttendanceSummarySchema = z.object({
  attended: z.number(),
  noShow: z.number(),
  excused: z.number(),
  unmarked: z.number(),
  total: z.number(),
  attendanceRate: z.number(),
});
export type EventAttendanceSummaryDto = z.infer<typeof EventAttendanceSummarySchema>;

/** Single row in the per-event roster breakdown table */
export const RosterBreakdownEntrySchema = z.object({
  userId: z.number(),
  username: z.string(),
  avatar: z.string().nullable(),
  attendanceStatus: AttendanceStatusSchema.nullable(),
  voiceClassification: VoiceClassificationEnum.nullable(),
  voiceDurationSec: z.number().nullable(),
  signupStatus: z.string().nullable(),
});
export type RosterBreakdownEntryDto = z.infer<typeof RosterBreakdownEntrySchema>;

/** Voice summary for per-event metrics (nullable — no voice data means null) */
export const EventVoiceSummarySchema = z.object({
  totalTracked: z.number(),
  full: z.number(),
  partial: z.number(),
  late: z.number(),
  earlyLeaver: z.number(),
  noShow: z.number(),
  sessions: z.array(EventVoiceSessionSchema),
});
export type EventVoiceSummaryDto = z.infer<typeof EventVoiceSummarySchema>;

/** Response for GET /events/:id/metrics */
export const EventMetricsResponseSchema = z.object({
  eventId: z.number(),
  title: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  game: z.object({
    id: z.number(),
    name: z.string(),
    coverUrl: z.string().nullable(),
  }).nullable(),
  attendanceSummary: EventAttendanceSummarySchema,
  voiceSummary: EventVoiceSummarySchema.nullable(),
  rosterBreakdown: z.array(RosterBreakdownEntrySchema),
});
export type EventMetricsResponseDto = z.infer<typeof EventMetricsResponseSchema>;
