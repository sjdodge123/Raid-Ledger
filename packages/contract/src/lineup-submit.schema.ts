import { z } from 'zod';

// ============================================================
// Lineup Submit Schemas (ROK-1296, U4 SubmitBar)
// ============================================================
//
// Bodies are intentionally empty — the auth user is implicit and the
// timestamp is server-stamped (`now()`). Submitting is idempotent and
// re-stamps on every call (the operator-confirmed "change my X" semantic).

/** Request body for POST /lineups/:id/submit-nominations. */
export const SubmitNominationsRequestSchema = z.object({}).strict();

export type SubmitNominationsRequestDto = z.infer<
    typeof SubmitNominationsRequestSchema
>;

/** Request body for POST /lineups/:id/submit-votes. */
export const SubmitVotesRequestSchema = z.object({}).strict();

export type SubmitVotesRequestDto = z.infer<typeof SubmitVotesRequestSchema>;

/** Request body for POST /lineups/:id/matches/:matchId/submit-scheduling. */
export const SubmitSchedulingRequestSchema = z.object({}).strict();

export type SubmitSchedulingRequestDto = z.infer<
    typeof SubmitSchedulingRequestSchema
>;

/**
 * Viewer's submission timestamps for a lineup (ROK-1296).
 * Embedded into `LineupDetailResponseDto.viewerSubmissions` for the authed
 * caller. Both fields are ISO 8601 UTC strings or null when the viewer has
 * not yet submitted that phase.
 */
export const ViewerSubmissionsSchema = z.object({
    nominationsSubmittedAt: z.string().nullable(),
    votesSubmittedAt: z.string().nullable(),
});

export type ViewerSubmissionsDto = z.infer<typeof ViewerSubmissionsSchema>;
