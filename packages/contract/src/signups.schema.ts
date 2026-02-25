import { z } from 'zod';

// ============================================================
// Signup Schemas (FR-006 + ROK-131 Character Confirmation + ROK-137 Interactive Buttons)
// ============================================================

/** Confirmation status for event signups (ROK-131 AC-1) */
export const ConfirmationStatusSchema = z.enum(['pending', 'confirmed', 'changed']);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

/** Signup status for attendance intent (ROK-137, ROK-421) */
export const SignupStatusSchema = z.enum(['signed_up', 'tentative', 'declined', 'roached_out']);
export type SignupStatus = z.infer<typeof SignupStatusSchema>;

/** Post-event attendance status recorded by organizer (ROK-421) */
export const AttendanceStatusSchema = z.enum(['attended', 'no_show', 'excused', 'unmarked']);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

/** Single signup user info with Discord avatar (ROK-194: includes characters for avatar resolution) */
export const SignupUserSchema = z.object({
    id: z.number(),
    discordId: z.string(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable().optional(),
    /** Optional characters array for avatar resolution (ROK-194) */
    characters: z.array(z.object({
        gameId: z.number(),
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
    level: z.number().nullable().optional(),
    avatarUrl: z.string().nullable(),
    race: z.string().nullable().optional(),
    faction: z.enum(['alliance', 'horde']).nullable().optional(),
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
    /** Attendance status (ROK-137) */
    status: SignupStatusSchema,
    /** ROK-452: Preferred roles the player is willing to play */
    preferredRoles: z.array(z.enum(['tank', 'healer', 'dps'])).nullable().optional(),
    /** Whether this is an anonymous Discord participant (ROK-137) */
    isAnonymous: z.boolean().optional(),
    /** Discord info for anonymous participants (ROK-137) */
    discordUserId: z.string().nullable().optional(),
    discordUsername: z.string().nullable().optional(),
    discordAvatarHash: z.string().nullable().optional(),
    /** Post-event attendance tracking (ROK-421) */
    attendanceStatus: AttendanceStatusSchema.nullable().optional(),
    attendanceRecordedAt: z.string().datetime().nullable().optional(),
});

export type SignupResponseDto = z.infer<typeof SignupResponseSchema>;

/** Event roster response - list of signups */
export const EventRosterSchema = z.object({
    eventId: z.number(),
    signups: z.array(SignupResponseSchema),
    count: z.number(),
});

export type EventRosterDto = z.infer<typeof EventRosterSchema>;

/** Create signup request - optional note, slot preference (ROK-183), and character (ROK-439) */
export const CreateSignupSchema = z.object({
    note: z.string().max(200).optional(),
    /** ROK-183: Optional slot preference for direct assignment */
    slotRole: z.enum(['tank', 'healer', 'dps', 'flex', 'player', 'bench']).optional(),
    slotPosition: z.number().min(1).optional(),
    /** ROK-439: Optional character ID for selection-first signup (skip separate confirm step) */
    characterId: z.string().uuid().optional(),
    /** ROK-452: Preferred roles the player is willing to play (multi-role signup) */
    preferredRoles: z.array(z.enum(['tank', 'healer', 'dps'])).min(1).max(3).optional(),
});

export type CreateSignupDto = z.infer<typeof CreateSignupSchema>;

/** Confirm signup with character selection (ROK-131 AC-2) */
export const ConfirmSignupSchema = z.object({
    characterId: z.string().uuid(),
});

export type ConfirmSignupDto = z.infer<typeof ConfirmSignupSchema>;

// ============================================================
// Discord Signup Schemas (ROK-137)
// ============================================================

/** User-selectable signup statuses (excludes internal roached_out) */
export const UserSignupStatusSchema = z.enum(['signed_up', 'tentative', 'declined']);

/** Create anonymous Discord signup */
export const CreateDiscordSignupSchema = z.object({
    discordUserId: z.string(),
    discordUsername: z.string(),
    discordAvatarHash: z.string().nullable().optional(),
    /** Optional role for games that require roles */
    role: z.enum(['tank', 'healer', 'dps', 'flex', 'player']).optional(),
    status: UserSignupStatusSchema.optional(),
    /** ROK-452: Preferred roles the player is willing to play (multi-role signup) */
    preferredRoles: z.array(z.enum(['tank', 'healer', 'dps'])).min(1).max(3).optional(),
});

export type CreateDiscordSignupDto = z.infer<typeof CreateDiscordSignupSchema>;

/** Update signup status (tentative/declined/signed_up) */
export const UpdateSignupStatusSchema = z.object({
    status: UserSignupStatusSchema,
});

export type UpdateSignupStatusDto = z.infer<typeof UpdateSignupStatusSchema>;

// ============================================================
// Intent Token Schemas (ROK-137 Deferred Signup)
// ============================================================

/** Intent token payload for deferred signup */
export const IntentTokenPayloadSchema = z.object({
    eventId: z.number(),
    discordId: z.string(),
    action: z.literal('signup'),
    /** Token creation timestamp for TTL validation */
    iat: z.number().optional(),
});

export type IntentTokenPayload = z.infer<typeof IntentTokenPayloadSchema>;

/** Redeem intent request body */
export const RedeemIntentSchema = z.object({
    token: z.string(),
});

export type RedeemIntentDto = z.infer<typeof RedeemIntentSchema>;

/** Redeem intent response */
export const RedeemIntentResponseSchema = z.object({
    success: z.boolean(),
    eventId: z.number().optional(),
    message: z.string(),
});

export type RedeemIntentResponseDto = z.infer<typeof RedeemIntentResponseSchema>;

// ============================================================
// Attendance Tracking Schemas (ROK-421)
// ============================================================

/** Request body for recording attendance on a single signup */
export const RecordAttendanceSchema = z.object({
    signupId: z.number(),
    attendanceStatus: AttendanceStatusSchema,
});

export type RecordAttendanceDto = z.infer<typeof RecordAttendanceSchema>;

/** Attendance summary for a past event */
export const AttendanceSummarySchema = z.object({
    eventId: z.number(),
    totalSignups: z.number(),
    attended: z.number(),
    noShow: z.number(),
    excused: z.number(),
    unmarked: z.number(),
    attendanceRate: z.number(),
    noShowRate: z.number(),
    signups: z.array(SignupResponseSchema),
});

export type AttendanceSummaryDto = z.infer<typeof AttendanceSummarySchema>;
