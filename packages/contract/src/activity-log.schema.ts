import { z } from 'zod';

// ============================================================
// Activity Log Schemas (ROK-930)
// ============================================================

/** All supported activity action types across entity types. */
export const ActivityActionSchema = z.enum([
    // Lineup actions
    'lineup_created',
    'game_nominated',
    'nomination_removed',
    'game_carried_over',
    'voting_started',
    'vote_cast',
    'lineup_decided',
    'lineup_aborted',
    'event_linked',
    // Event actions
    'event_created',
    'signup_added',
    'signup_cancelled',
    'roster_allocated',
    'event_cancelled',
    'event_rescheduled',
]);

export type ActivityActionDto = z.infer<typeof ActivityActionSchema>;

/** Entity types that can have activity timelines. */
export const ActivityEntityTypeSchema = z.enum(['lineup', 'event']);

export type ActivityEntityTypeDto = z.infer<typeof ActivityEntityTypeSchema>;

// ============================================================
// Response Schemas
// ============================================================

/** Actor identity embedded in activity entries. */
const ActivityActorSchema = z.object({
    id: z.number(),
    // Non-null at the API boundary — backend uses displayNameSql(users).
    displayName: z.string(),
});

/** A single activity log entry. */
export const ActivityEntrySchema = z.object({
    id: z.number(),
    action: ActivityActionSchema,
    actor: ActivityActorSchema.nullable(),
    metadata: z.record(z.unknown()).nullable(),
    createdAt: z.string(),
});

export type ActivityEntryDto = z.infer<typeof ActivityEntrySchema>;

/** Activity timeline response. */
export const ActivityTimelineResponseSchema = z.object({
    data: z.array(ActivityEntrySchema),
});

export type ActivityTimelineResponseDto = z.infer<typeof ActivityTimelineResponseSchema>;
