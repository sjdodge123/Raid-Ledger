import { z } from 'zod';
import { CreateSignupSchema, SignupStatusSchema } from './signups.schema.js';

// ============================================================
// Series Signup Schemas (ROK-1728) — join a recurring series in one click
// ============================================================

/** Membership status: `left` = the user left; `ended` = the system ended it. */
export const SeriesSignupStatusSchema = z.enum(['active', 'left', 'ended']);
export type SeriesSignupStatus = z.infer<typeof SeriesSignupStatusSchema>;

/** Why a membership ended: `user_left` pairs with `left`, the rest with `ended`. */
export const SeriesSignupEndedReasonSchema = z.enum([
    'user_left',
    'deactivated',
    'series_cancelled',
    'series_deleted',
]);
export type SeriesSignupEndedReason = z.infer<typeof SeriesSignupEndedReasonSchema>;

/** Request body for joining a series — per-night choices (note, slot) are excluded. */
export const JoinSeriesSchema = CreateSignupSchema.pick({
    characterId: true,
    preferredRoles: true,
});
export type JoinSeriesDto = z.infer<typeof JoinSeriesSchema>;

/** A series membership row. */
export const SeriesSignupSchema = z.object({
    id: z.number().int().positive(),
    recurrenceGroupId: z.string().uuid(),
    userId: z.number().int().positive(),
    characterId: z.string().uuid().nullable(),
    preferredRoles: z.array(z.enum(['tank', 'healer', 'dps'])).nullable(),
    status: SeriesSignupStatusSchema,
    endedReason: SeriesSignupEndedReasonSchema.nullable(),
    joinedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
});
export type SeriesSignupDto = z.infer<typeof SeriesSignupSchema>;

/** Preview vocabulary for one night; `in_series` = already tagged by the active membership. */
export const SeriesNightStateSchema = z.enum([
    'will_create',
    'will_attach',
    'stays_inactive',
    'in_series',
]);
export type SeriesNightState = z.infer<typeof SeriesNightStateSchema>;

/** One future, non-cancelled occurrence of the series. */
export const SeriesNightSchema = z.object({
    eventId: z.number().int().positive(),
    startTime: z.string().datetime(),
    state: SeriesNightStateSchema,
    signupStatus: SignupStatusSchema.nullable(),
});
export type SeriesNightDto = z.infer<typeof SeriesNightSchema>;
/** A night Leave would cancel: just the id and start. */
export type SeriesLeaveNightDto = Pick<SeriesNightDto, 'eventId' | 'startTime'>;

/** GET /events/:id/series/signup — membership + the nights from `:id` forward. */
export const SeriesSignupStateSchema = z.object({
    membership: SeriesSignupSchema.nullable(),
    nights: z.array(SeriesNightSchema),
    /** will_create + will_attach — the "Join N nights" number. */
    joinableCount: z.number().int().nonnegative(),
    /** Span of the joinable nights only. */
    firstNight: z.string().datetime().nullable(),
    lastNight: z.string().datetime().nullable(),
    /**
     * Active members only: every future night Leave would cancel (all tagged
     * active signups from now, not only from `:id` forward), by start time.
     * Additive and optional — absent for a non-member.
     */
    leaveNights: z.array(SeriesNightSchema.pick({ eventId: true, startTime: true })).optional(),
});
export type SeriesSignupStateDto = z.infer<typeof SeriesSignupStateSchema>;

/** A night the join or leave could not apply, with the user-facing reason. */
export const SeriesNightFailureSchema = z.object({
    eventId: z.number(),
    message: z.string(),
});
export type SeriesNightFailureDto = z.infer<typeof SeriesNightFailureSchema>;

/** POST /events/:id/series/signup response — best-effort per night. */
export const JoinSeriesResponseSchema = z.object({
    membership: SeriesSignupSchema,
    attachedEventIds: z.array(z.number()),
    createdEventIds: z.array(z.number()),
    keptEventIds: z.array(z.number()),
    failed: z.array(SeriesNightFailureSchema),
});
export type JoinSeriesResponseDto = z.infer<typeof JoinSeriesResponseSchema>;

/** DELETE /events/:id/series/signup response; `lateCancelledEventIds` ⊆ cancelled (<23h). */
export const LeaveSeriesResponseSchema = z.object({
    membership: SeriesSignupSchema,
    cancelledEventIds: z.array(z.number()),
    lateCancelledEventIds: z.array(z.number()),
    /** Nights whose cancel failed — left as they were but untagged (additive, optional). */
    failed: z.array(SeriesNightFailureSchema).optional(),
});
export type LeaveSeriesResponseDto = z.infer<typeof LeaveSeriesResponseSchema>;
