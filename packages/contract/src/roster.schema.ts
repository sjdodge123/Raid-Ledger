import { z } from 'zod';

/**
 * Valid role types for roster slots (ROK-114, ROK-183).
 * - tank/healer/dps/flex: MMO-style role-based games
 * - player: Generic numbered slots for non-role games
 * - bench: Overflow/waitlist slots
 */
export const RosterRoleSchema = z.enum(['tank', 'healer', 'dps', 'flex', 'player', 'bench']);
export type RosterRole = z.infer<typeof RosterRoleSchema>;

/**
 * Single roster assignment in a request.
 */
export const RosterAssignmentSchema = z.object({
    /** User ID to assign to the slot */
    userId: z.number().int().positive(),
    /** Optional signup ID (derived from userId if not provided) */
    signupId: z.number().int().positive().optional(),
    /** Role slot (tank, healer, dps, flex) - null for non-role events */
    slot: RosterRoleSchema.nullable(),
    /** Position within the role (1-based) */
    position: z.number().int().min(1).default(1),
    /** Override flag for off-spec assignments */
    isOverride: z.boolean().default(false),
});
export type RosterAssignment = z.infer<typeof RosterAssignmentSchema>;

/**
 * Request body for updating roster assignments.
 * PATCH /events/:id/roster
 */
export const UpdateRosterSchema = z.object({
    assignments: z.array(RosterAssignmentSchema),
});
export type UpdateRosterDto = z.infer<typeof UpdateRosterSchema>;

/**
 * Single roster assignment in a response.
 */
export const RosterAssignmentResponseSchema = z.object({
    id: z.number(),
    signupId: z.number(),
    userId: z.number(),
    discordId: z.string(),
    username: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable().optional(),
    slot: RosterRoleSchema.nullable(),
    position: z.number(),
    isOverride: z.boolean(),
    /** Character info if confirmed (ROK-194: includes avatarUrl) */
    character: z.object({
        id: z.string().uuid(),
        name: z.string(),
        className: z.string().nullable(),
        role: z.string().nullable(),
        avatarUrl: z.string().nullable(),
    }).nullable(),
    /** ROK-452: Preferred roles the player is willing to play */
    preferredRoles: z.array(z.enum(['tank', 'healer', 'dps'])).nullable().optional(),
});
export type RosterAssignmentResponse = z.infer<typeof RosterAssignmentResponseSchema>;

/**
 * Response for GET/PATCH /events/:id/roster with assignments.
 */
export const RosterWithAssignmentsSchema = z.object({
    eventId: z.number(),
    /** Users in the signup pool (not yet assigned) */
    pool: z.array(RosterAssignmentResponseSchema),
    /** Users assigned to roster slots */
    assignments: z.array(RosterAssignmentResponseSchema),
    /** Slot configuration for the event (ROK-183: supports generic games) */
    slots: z.object({
        tank: z.number().optional(),
        healer: z.number().optional(),
        dps: z.number().optional(),
        flex: z.number().optional(),
        player: z.number().optional(),  // Generic numbered slots
        bench: z.number().optional(),   // Overflow/waitlist
    }).optional(),
});
export type RosterWithAssignments = z.infer<typeof RosterWithAssignmentsSchema>;
