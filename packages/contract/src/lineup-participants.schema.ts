/**
 * Community Lineup participants roster (ROK-1346).
 *
 * Powers the hero "Participants · N" button + read-only roster modal, present
 * across every lineup phase. Served by `GET /lineups/:id/participants` (a
 * separate read-open endpoint, mirroring the invitee separation) so the detail
 * response stays lean.
 *
 * The participant shape mirrors the scheduling-votes participant — `avatar` +
 * `customAvatarUrl` + `discordId` (NOT a single server-side `avatarUrl`); the
 * frontend resolves the effective URL via `web/src/lib/avatar.ts`.
 */
import { z } from 'zod';

/** How a user is attached to the lineup. Precedence: creator > invitee > participant. */
export const LineupParticipantRoleSchema = z.enum([
    'creator',
    'invitee',
    'participant',
]);

export type LineupParticipantRole = z.infer<typeof LineupParticipantRoleSchema>;

/**
 * Phase-agnostic participation status. Precedence: `voted` > `nominated` >
 * `waiting` (a voter is `voted`, a nominator-only is `nominated`, an
 * invitee/eligible-with-no-action is `waiting`).
 */
export const LineupParticipantStatusSchema = z.enum([
    'nominated',
    'voted',
    'waiting',
]);

export type LineupParticipantStatus = z.infer<
    typeof LineupParticipantStatusSchema
>;

/** A single roster row. */
export const LineupParticipantSchema = z.object({
    userId: z.number().int(),
    displayName: z.string(),
    avatar: z.string().nullable(),
    customAvatarUrl: z.string().nullable(),
    discordId: z.string().nullable(),
    role: LineupParticipantRoleSchema,
    status: LineupParticipantStatusSchema,
    steamLinked: z.boolean(),
});

export type LineupParticipantDto = z.infer<typeof LineupParticipantSchema>;

/** Response for GET /lineups/:id/participants. */
export const LineupParticipantsResponseSchema = z.object({
    participants: z.array(LineupParticipantSchema),
});

export type LineupParticipantsResponseDto = z.infer<
    typeof LineupParticipantsResponseSchema
>;
