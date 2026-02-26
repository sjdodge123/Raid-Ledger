import { z } from 'zod';

// ============================================================
// Ad-Hoc Event Schemas (ROK-293)
// ============================================================

/** Ad-hoc event lifecycle status */
export const AdHocStatusEnum = z.enum(['live', 'grace_period', 'ended']);
export type AdHocStatus = z.infer<typeof AdHocStatusEnum>;

/** Single participant in an ad-hoc event roster */
export const AdHocParticipantSchema = z.object({
    id: z.string().uuid(),
    eventId: z.number(),
    userId: z.number().nullable(),
    discordUserId: z.string(),
    discordUsername: z.string(),
    discordAvatarHash: z.string().nullable(),
    joinedAt: z.string().datetime(),
    leftAt: z.string().datetime().nullable(),
    totalDurationSeconds: z.number().nullable(),
    sessionCount: z.number(),
});

export type AdHocParticipantDto = z.infer<typeof AdHocParticipantSchema>;

/** Response for ad-hoc event roster endpoint */
export const AdHocRosterResponseSchema = z.object({
    eventId: z.number(),
    participants: z.array(AdHocParticipantSchema),
    activeCount: z.number(),
});

export type AdHocRosterResponseDto = z.infer<typeof AdHocRosterResponseSchema>;

/** Admin settings for ad-hoc events feature */
export const AdHocEventSettingsSchema = z.object({
    enabled: z.boolean(),
});

export type AdHocEventSettingsDto = z.infer<typeof AdHocEventSettingsSchema>;
