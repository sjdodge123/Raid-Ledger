import { z } from 'zod';

// ============================================================
// Match & Scheduling Enums (ROK-964)
// ============================================================

/** Match lifecycle: suggested -> scheduling -> scheduled -> archived */
export const MatchStatusSchema = z.enum([
    'suggested',
    'scheduling',
    'scheduled',
    'archived',
]);

export type MatchStatusDto = z.infer<typeof MatchStatusSchema>;

/** How well the match group fills its player requirements. */
export const FitTypeSchema = z.enum([
    'perfect',
    'normal',
    'oversubscribed',
    'undersubscribed',
]);

export type FitTypeDto = z.infer<typeof FitTypeSchema>;

/** How a member was added to a match group. */
export const MemberSourceSchema = z.enum(['voted', 'bandwagon']);

export type MemberSourceDto = z.infer<typeof MemberSourceSchema>;

/** Who proposed a schedule slot. */
export const SlotSuggesterSchema = z.enum(['system', 'user']);

export type SlotSuggesterDto = z.infer<typeof SlotSuggesterSchema>;

// ============================================================
// Match & Scheduling Response Schemas (ROK-964)
// ============================================================

/** A game match group within a lineup. */
export const LineupMatchSchema = z.object({
    id: z.number(),
    lineupId: z.number(),
    gameId: z.number(),
    status: MatchStatusSchema,
    thresholdMet: z.boolean(),
    voteCount: z.number(),
    votePercentage: z.number().nullable(),
    fitType: FitTypeSchema.nullable(),
    linkedEventId: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type LineupMatchDto = z.infer<typeof LineupMatchSchema>;

/** A member assigned to a match group. */
export const LineupMatchMemberSchema = z.object({
    id: z.number(),
    matchId: z.number(),
    userId: z.number(),
    source: MemberSourceSchema,
    createdAt: z.string(),
});

export type LineupMatchMemberDto = z.infer<typeof LineupMatchMemberSchema>;

/** A proposed time slot for scheduling a match. */
export const LineupScheduleSlotSchema = z.object({
    id: z.number(),
    matchId: z.number(),
    proposedTime: z.string(),
    overlapScore: z.number().nullable(),
    suggestedBy: SlotSuggesterSchema,
    createdAt: z.string(),
});

export type LineupScheduleSlotDto = z.infer<typeof LineupScheduleSlotSchema>;

/** A user vote on a schedule time slot. */
export const LineupScheduleVoteSchema = z.object({
    id: z.number(),
    slotId: z.number(),
    userId: z.number(),
    createdAt: z.string(),
});

export type LineupScheduleVoteDto = z.infer<typeof LineupScheduleVoteSchema>;

// ============================================================
// Composite DTOs (ROK-964)
// ============================================================

/** Match detail with game info and enriched members. */
export const MatchDetailResponseSchema = LineupMatchSchema.extend({
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    members: z.array(
        LineupMatchMemberSchema.extend({
            displayName: z.string(),
            avatar: z.string().nullable(),
            discordId: z.string().nullable(),
            customAvatarUrl: z.string().nullable(),
        }),
    ),
});

export type MatchDetailResponseDto = z.infer<typeof MatchDetailResponseSchema>;

/** Schedule poll with slots and voter details. */
export const SchedulePollResponseSchema = z.object({
    matchId: z.number(),
    slots: z.array(
        LineupScheduleSlotSchema.extend({
            votes: z.array(
                z.object({
                    userId: z.number(),
                    displayName: z.string(),
                }),
            ),
        }),
    ),
});

export type SchedulePollResponseDto = z.infer<typeof SchedulePollResponseSchema>;
