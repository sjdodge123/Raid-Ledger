import { z } from 'zod';

// ============================================================
// Voice Attendance Schemas (ROK-490)
// ============================================================

/** Classification of a user's voice attendance during a scheduled event */
export const VoiceClassificationEnum = z.enum([
  'full',
  'partial',
  'late',
  'early_leaver',
  'no_show',
]);
export type VoiceClassification = z.infer<typeof VoiceClassificationEnum>;

/** A single join/leave segment within a voice session */
export const VoiceSessionSegmentSchema = z.object({
  joinAt: z.string().datetime(),
  leaveAt: z.string().datetime().nullable(),
  durationSec: z.number(),
});
export type VoiceSessionSegment = z.infer<typeof VoiceSessionSegmentSchema>;

/** A single user's voice session for a scheduled event */
export const EventVoiceSessionSchema = z.object({
  id: z.string().uuid(),
  eventId: z.number(),
  userId: z.number().nullable(),
  discordUserId: z.string(),
  discordUsername: z.string(),
  firstJoinAt: z.string().datetime(),
  lastLeaveAt: z.string().datetime().nullable(),
  totalDurationSec: z.number(),
  segments: z.array(VoiceSessionSegmentSchema),
  classification: VoiceClassificationEnum.nullable(),
});
export type EventVoiceSessionDto = z.infer<typeof EventVoiceSessionSchema>;

/** Response for GET /events/:id/voice-sessions */
export const VoiceSessionsResponseSchema = z.object({
  eventId: z.number(),
  sessions: z.array(EventVoiceSessionSchema),
});
export type VoiceSessionsResponseDto = z.infer<typeof VoiceSessionsResponseSchema>;

/** Summary stats for voice attendance */
export const VoiceAttendanceSummarySchema = z.object({
  eventId: z.number(),
  totalTracked: z.number(),
  full: z.number(),
  partial: z.number(),
  late: z.number(),
  earlyLeaver: z.number(),
  noShow: z.number(),
  unclassified: z.number(),
  sessions: z.array(EventVoiceSessionSchema),
});
export type VoiceAttendanceSummaryDto = z.infer<typeof VoiceAttendanceSummarySchema>;
