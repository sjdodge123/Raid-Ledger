import { z } from 'zod';

// ============================================================
// Event Plan Schemas (ROK-392)
// ============================================================

/** Poll mode determines how "None of these work" votes are handled. */
export const PollModeSchema = z.enum(['standard', 'all_or_nothing']);
export type PollMode = z.infer<typeof PollModeSchema>;

/** Event plan lifecycle status. */
export const EventPlanStatusSchema = z.enum([
  'draft',
  'polling',
  'completed',
  'expired',
  'cancelled',
]);
export type EventPlanStatus = z.infer<typeof EventPlanStatusSchema>;

/** A single poll option (candidate time slot). */
export const PollOptionSchema = z.object({
  date: z.string(), // ISO 8601 date string
  label: z.string(), // Human-readable label for display
});
export type PollOption = z.infer<typeof PollOptionSchema>;

/** Slot config for the planned event (same shape as existing SlotConfigSchema). */
const PlanSlotConfigSchema = z
  .object({
    type: z.enum(['mmo', 'generic']),
    tank: z.number().int().min(0).optional(),
    healer: z.number().int().min(0).optional(),
    dps: z.number().int().min(0).optional(),
    flex: z.number().int().min(0).optional(),
    player: z.number().int().min(0).optional(),
    bench: z.number().int().min(0).optional(),
  })
  .optional()
  .nullable();

// ============================================================
// Create Event Plan DTO
// ============================================================

export const CreateEventPlanSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gameId: z.number().int().positive().optional(),
  slotConfig: PlanSlotConfigSchema,
  maxAttendees: z.number().int().min(1).optional(),
  autoUnbench: z.boolean().optional(),
  durationMinutes: z.number().int().min(1).max(1440),
  pollOptions: z
    .array(PollOptionSchema)
    .min(2, 'At least 2 time options are required')
    .max(9, 'Maximum 9 time options (10 total with "None of these work")'),
  pollDurationHours: z.number().int().min(1).max(72),
  pollMode: PollModeSchema.default('standard'),
  /** Content instances for the auto-created event (e.g. selected dungeons/raids) */
  contentInstances: z.array(z.record(z.string(), z.unknown())).optional(),
  /** Reminders for the auto-created event */
  reminder15min: z.boolean().optional(),
  reminder1hour: z.boolean().optional(),
  reminder24hour: z.boolean().optional(),
});

export type CreateEventPlanDto = z.infer<typeof CreateEventPlanSchema>;

// ============================================================
// Event Plan Response DTO
// ============================================================

export const EventPlanResponseSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  gameId: z.number().nullable(),
  slotConfig: PlanSlotConfigSchema,
  maxAttendees: z.number().nullable(),
  autoUnbench: z.boolean(),
  durationMinutes: z.number(),
  pollOptions: z.array(PollOptionSchema),
  pollDurationHours: z.number(),
  pollMode: PollModeSchema,
  pollRound: z.number(),
  pollChannelId: z.string().nullable(),
  pollMessageId: z.string().nullable(),
  status: EventPlanStatusSchema,
  winningOption: z.number().nullable(),
  createdEventId: z.number().nullable(),
  pollStartedAt: z.string().datetime().nullable(),
  pollEndsAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EventPlanResponseDto = z.infer<typeof EventPlanResponseSchema>;

// ============================================================
// Time Suggestion Schemas
// ============================================================

/** A single time suggestion with availability count. */
export const TimeSuggestionSchema = z.object({
  date: z.string(), // ISO 8601 datetime string
  label: z.string(), // Human-readable label (e.g., "Friday 7:00 PM")
  availableCount: z.number().int().min(0),
});

export type TimeSuggestion = z.infer<typeof TimeSuggestionSchema>;

/** Response from the time suggestions endpoint. */
export const TimeSuggestionsResponseSchema = z.object({
  source: z.enum(['game-interest', 'fallback']),
  interestedPlayerCount: z.number().int().min(0),
  suggestions: z.array(TimeSuggestionSchema),
});

export type TimeSuggestionsResponse = z.infer<
  typeof TimeSuggestionsResponseSchema
>;

// ============================================================
// Poll Results Schemas (ROK-392 enhanced)
// ============================================================

/** A single voter in poll results. */
export const PollVoterSchema = z.object({
  discordId: z.string(),
  username: z.string().nullable(),
  isRegistered: z.boolean(),
});
export type PollVoter = z.infer<typeof PollVoterSchema>;

/** Poll results for a single answer option. */
export const PollOptionResultSchema = z.object({
  index: z.number(),
  label: z.string(),
  totalVotes: z.number(),
  registeredVotes: z.number(),
  voters: z.array(PollVoterSchema),
});
export type PollOptionResult = z.infer<typeof PollOptionResultSchema>;

/** Full poll results response. */
export const PollResultsResponseSchema = z.object({
  planId: z.string().uuid(),
  status: EventPlanStatusSchema,
  pollOptions: z.array(PollOptionResultSchema),
  noneOption: PollOptionResultSchema.nullable(),
  totalRegisteredVoters: z.number(),
  pollEndsAt: z.string().datetime().nullable(),
});
export type PollResultsResponse = z.infer<typeof PollResultsResponseSchema>;
