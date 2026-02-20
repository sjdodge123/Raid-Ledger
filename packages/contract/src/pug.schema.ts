import { z } from 'zod';

// ============================================================
// PUG Slot Schemas (ROK-262)
// ============================================================

/** Valid PUG slot status values */
export const PugSlotStatusSchema = z.enum([
    'pending',
    'invited',
    'accepted',
    'claimed',
]);
export type PugSlotStatus = z.infer<typeof PugSlotStatusSchema>;

/** Valid PUG role values (same as MMO roles) */
export const PugRoleSchema = z.enum(['tank', 'healer', 'dps']);
export type PugRole = z.infer<typeof PugRoleSchema>;

/** Schema for creating a PUG slot */
export const CreatePugSlotSchema = z.object({
    /** Discord username — optional for anonymous invite links (ROK-263) */
    discordUsername: z.string().min(1).max(100).optional(),
    /** Role is optional at invite time — the invitee selects it on accept */
    role: PugRoleSchema.optional().default('dps'),
    class: z.string().max(50).optional(),
    spec: z.string().max(50).optional(),
    notes: z.string().max(500).optional(),
});

export type CreatePugSlotDto = z.infer<typeof CreatePugSlotSchema>;

/** Schema for updating a PUG slot */
export const UpdatePugSlotSchema = z.object({
    discordUsername: z.string().min(1).max(100).optional(),
    role: PugRoleSchema.optional(),
    class: z.string().max(50).optional().nullable(),
    spec: z.string().max(50).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
});

export type UpdatePugSlotDto = z.infer<typeof UpdatePugSlotSchema>;

/** Single PUG slot response */
export const PugSlotResponseSchema = z.object({
    id: z.string().uuid(),
    eventId: z.number(),
    discordUsername: z.string().nullable().optional(),
    discordUserId: z.string().nullable().optional(),
    discordAvatarHash: z.string().nullable().optional(),
    role: PugRoleSchema,
    class: z.string().nullable().optional(),
    spec: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    status: PugSlotStatusSchema,
    serverInviteUrl: z.string().nullable().optional(),
    /** Magic invite link code (ROK-263) */
    inviteCode: z.string().nullable().optional(),
    claimedByUserId: z.number().nullable().optional(),
    createdBy: z.number(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export type PugSlotResponseDto = z.infer<typeof PugSlotResponseSchema>;

/** List response for PUG slots */
export const PugSlotListResponseSchema = z.object({
    pugs: z.array(PugSlotResponseSchema),
});

export type PugSlotListResponseDto = z.infer<typeof PugSlotListResponseSchema>;

// ============================================================
// Invite Code Schemas (ROK-263)
// ============================================================

/** Response when resolving an invite code */
export const InviteCodeResolveResponseSchema = z.object({
    valid: z.boolean(),
    event: z.object({
        id: z.number(),
        title: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        game: z.object({
            name: z.string(),
            coverUrl: z.string().nullable().optional(),
        }).nullable().optional(),
    }).optional(),
    slot: z.object({
        id: z.string().uuid(),
        role: PugRoleSchema,
        status: PugSlotStatusSchema,
    }).optional(),
    error: z.string().optional(),
});

export type InviteCodeResolveResponseDto = z.infer<typeof InviteCodeResolveResponseSchema>;

/** Request body for claiming an invite code */
export const InviteCodeClaimSchema = z.object({
    /** Optional — if the user wants to sign up with a specific role */
    role: PugRoleSchema.optional(),
});

export type InviteCodeClaimDto = z.infer<typeof InviteCodeClaimSchema>;

/** Response from sharing an event to Discord channels */
export const ShareEventResponseSchema = z.object({
    channelsPosted: z.number(),
    channelsSkipped: z.number(),
});

export type ShareEventResponseDto = z.infer<typeof ShareEventResponseSchema>;
