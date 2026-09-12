/**
 * Community Lineup invitees (ROK-1065).
 *
 * A "private" lineup is visibility-scoped: only explicit invitees (plus the
 * creator and any admin/operator) may participate. These schemas cover the
 * add / remove invitee endpoints used by the operator management UI.
 */
import { z } from 'zod';

/** Visibility mode for a community lineup (ROK-1065). */
export const LineupVisibilitySchema = z.enum(['public', 'private']);

export type LineupVisibilityDto = z.infer<typeof LineupVisibilitySchema>;

/**
 * Body for POST /lineups/:id/invitees — add one or more users as invitees.
 * A private lineup must have at least one invitee at all times.
 */
export const AddInviteesSchema = z.object({
    userIds: z.array(z.number().int().positive()).min(1),
});

export type AddInviteesDto = z.infer<typeof AddInviteesSchema>;

/** A single invitee row returned in lineup detail responses. */
export const LineupInviteeResponseSchema = z.object({
    id: z.number(),
    displayName: z.string(),
    /** True when the user has linked their Steam account. */
    steamLinked: z.boolean(),
    /**
     * ROK-1101 G2: id of the user who issued the invite, or null when the
     * invite predates the audit column or has no attributable actor.
     * Optional so existing clients that never read it keep compiling; the
     * API always sends it.
     */
    invitedBy: z.number().int().positive().nullable().optional(),
});

export type LineupInviteeResponseDto = z.infer<
    typeof LineupInviteeResponseSchema
>;
