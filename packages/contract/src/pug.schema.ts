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
    discordUsername: z
        .string()
        .min(1, 'Discord username is required')
        .max(100),
    role: PugRoleSchema,
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
    discordUsername: z.string(),
    discordUserId: z.string().nullable().optional(),
    discordAvatarHash: z.string().nullable().optional(),
    role: PugRoleSchema,
    class: z.string().nullable().optional(),
    spec: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    status: PugSlotStatusSchema,
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
