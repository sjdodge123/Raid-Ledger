import { z } from 'zod';

// ============================================================
// Signup Schemas (FR-006 + ROK-131 Character Confirmation)
// ============================================================

/** Confirmation status for event signups (ROK-131 AC-1) */
export const ConfirmationStatusSchema = z.enum(['pending', 'confirmed', 'changed']);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

/** Single signup user info with Discord avatar (ROK-194: includes characters for avatar resolution) */
export const SignupUserSchema = z.object({
    id: z.number(),
    discordId: z.string(),
    username: z.string(),
    avatar: z.string().nullable(),
    /** Optional characters array for avatar resolution (ROK-194) */
    characters: z.array(z.object({
        gameId: z.string().uuid(),
        avatarUrl: z.string().nullable(),
    })).optional(),
});

export type SignupUserDto = z.infer<typeof SignupUserSchema>;

/** Character info for roster display (ROK-131 AC-6) */
export const SignupCharacterSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    class: z.string().nullable(),
    spec: z.string().nullable(),
    role: z.enum(['tank', 'healer', 'dps']).nullable(),
    isMain: z.boolean(),
    itemLevel: z.number().nullable(),
    avatarUrl: z.string().nullable(),
});

export type SignupCharacterDto = z.infer<typeof SignupCharacterSchema>;

/** Single signup response with optional character confirmation */
export const SignupResponseSchema = z.object({
    id: z.number(),
    eventId: z.number(),
    user: SignupUserSchema,
    note: z.string().nullable(),
    signedUpAt: z.string().datetime(),
    /** Character confirmation fields (ROK-131) */
    characterId: z.string().uuid().nullable(),
    character: SignupCharacterSchema.nullable(),
    confirmationStatus: ConfirmationStatusSchema,
});

export type SignupResponseDto = z.infer<typeof SignupResponseSchema>;

/** Event roster response - list of signups */
export const EventRosterSchema = z.object({
    eventId: z.number(),
    signups: z.array(SignupResponseSchema),
    count: z.number(),
});

export type EventRosterDto = z.infer<typeof EventRosterSchema>;

/** Create signup request - optional note and slot preference (ROK-183) */
export const CreateSignupSchema = z.object({
    note: z.string().max(200).optional(),
    /** ROK-183: Optional slot preference for direct assignment */
    slotRole: z.enum(['tank', 'healer', 'dps', 'flex', 'player', 'bench']).optional(),
    slotPosition: z.number().min(1).optional(),
}).refine(
    // Both or neither must be provided
    (data) => (data.slotRole === undefined) === (data.slotPosition === undefined),
    { message: 'slotRole and slotPosition must both be provided or both be omitted' }
);

export type CreateSignupDto = z.infer<typeof CreateSignupSchema>;

/** Confirm signup with character selection (ROK-131 AC-2) */
export const ConfirmSignupSchema = z.object({
    characterId: z.string().uuid(),
});

export type ConfirmSignupDto = z.infer<typeof ConfirmSignupSchema>;
