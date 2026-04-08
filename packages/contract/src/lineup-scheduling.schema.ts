import { z } from 'zod';
import {
  LineupScheduleSlotSchema,
  MatchDetailResponseSchema,
} from './lineup-match.schema.js';

// ============================================================
// Request Schemas (ROK-965)
// ============================================================

/** Body for suggesting a new time slot. */
export const SuggestSlotSchema = z.object({
  proposedTime: z.string().datetime({ offset: true }),
});

export type SuggestSlotDto = z.infer<typeof SuggestSlotSchema>;

/** Body for toggling a vote on a schedule slot. */
export const ToggleScheduleVoteSchema = z.object({
  slotId: z.number().int().positive(),
});

export type ToggleScheduleVoteDto = z.infer<typeof ToggleScheduleVoteSchema>;

/** Body for creating an event from a selected slot. */
export const CreateEventFromSlotSchema = z.object({
  slotId: z.number().int().positive(),
  /** When true, creates a weekly recurring series for 4 weeks. */
  recurring: z.boolean().optional().default(false),
});

export type CreateEventFromSlotDto = z.infer<typeof CreateEventFromSlotSchema>;

// ============================================================
// Response Schemas (ROK-965)
// ============================================================

/** Enriched slot with voter details. */
export const ScheduleSlotWithVotesSchema = LineupScheduleSlotSchema.extend({
  votes: z.array(
    z.object({
      userId: z.number(),
      displayName: z.string(),
      avatar: z.string().nullable(),
      discordId: z.string().nullable(),
      customAvatarUrl: z.string().nullable(),
    }),
  ),
});

export type ScheduleSlotWithVotesDto = z.infer<typeof ScheduleSlotWithVotesSchema>;

/** Full scheduling poll page response. */
export const SchedulePollPageResponseSchema = z.object({
  match: MatchDetailResponseSchema,
  slots: z.array(ScheduleSlotWithVotesSchema),
  myVotedSlotIds: z.array(z.number()),
  lineupStatus: z.string(),
});

export type SchedulePollPageResponseDto = z.infer<typeof SchedulePollPageResponseSchema>;

/** Lightweight banner for the events page. */
export const SchedulingBannerSchema = z.object({
  lineupId: z.number(),
  polls: z.array(
    z.object({
      matchId: z.number(),
      gameName: z.string(),
      gameCoverUrl: z.string().nullable(),
      memberCount: z.number(),
      slotCount: z.number(),
    }),
  ),
});

export type SchedulingBannerDto = z.infer<typeof SchedulingBannerSchema>;

/** Other scheduling polls for the current user. */
export const OtherPollsResponseSchema = z.object({
  polls: z.array(
    z.object({
      matchId: z.number(),
      gameName: z.string(),
      gameCoverUrl: z.string().nullable(),
      memberCount: z.number(),
    }),
  ),
});

export type OtherPollsResponseDto = z.infer<typeof OtherPollsResponseSchema>;
