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

/**
 * Body for cancelling a scheduling poll (ROK-1219 / F-38).
 * Optional reason surfaced to voters in the cancellation notification.
 * Additive — legacy no-body callers still validate via `safeParse(body ?? {})`.
 */
export const CancelSchedulePollSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CancelSchedulePollDto = z.infer<typeof CancelSchedulePollSchema>;

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
  /** Count of distinct users who voted on any slot (ROK-1015). */
  uniqueVoterCount: z.number().int().optional(),
  /** Slot IDs that conflict with the authenticated user's existing events (ROK-1031). */
  conflictingSlotIds: z.array(z.number()).optional(),
  /** Per-slot conflicting event titles for the "⚠ Conflicts with <event>" tooltip (ROK-1032). */
  slotConflicts: z
    .array(z.object({ slotId: z.number(), eventTitles: z.array(z.string()) }))
    .optional(),
  /** Lineup phase deadline (ISO). Null when no deadline configured (ROK-1217). */
  phaseDeadline: z.string().nullable().optional(),
  /**
   * True when this poll belongs to a standalone scheduling lineup (started
   * via the /events "Schedule a Game" flow, marked by
   * `phaseDurationOverride.standalone === true`) rather than a from-match
   * lineup (ROK-1300). Drives the composite's mode: standalone → noRibbon
   * hero + "started by you" badge with no cross-match refs; from-match →
   * 4-phase ribbon + "Match N of M". Server always sets it.
   */
  isStandalone: z.boolean(),
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
