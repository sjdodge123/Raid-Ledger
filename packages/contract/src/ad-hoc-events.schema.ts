import { z } from 'zod';

// ============================================================
// Ad-Hoc Event Schemas (ROK-293)
// ============================================================

/** Ad-hoc event lifecycle status */
export const AdHocStatusEnum = z.enum(['live', 'grace_period', 'ended']);
export type AdHocStatus = z.infer<typeof AdHocStatusEnum>;

/**
 * Which platform namespace a game-server player id belongs to (ROK-2232):
 * a SteamID64 (Valheim), a Minecraft Java player UUID, or an Xbox XUID
 * (Minecraft Bedrock). Ids of different kinds never compare equal.
 */
export const PlayerIdKindEnum = z.enum(['steam', 'minecraft-uuid', 'xuid']);
export type PlayerIdKind = z.infer<typeof PlayerIdKindEnum>;

/** Single participant in an ad-hoc event roster */
export const AdHocParticipantSchema = z.object({
    id: z.string().uuid(),
    eventId: z.number(),
    userId: z.number().nullable(),
    /**
     * Null for a Steam-only (game-server) participant (ROK-1800). Sent to
     * the event owner or an admin/operator (ROK-2323); any other viewer and
     * the `roster:update` socket broadcast get it only on a LINKED row
     * (`userId` set — that id is already public to members), else omitted.
     */
    discordUserId: z.string().nullable().optional(),
    /**
     * True when the row carries a Discord identity (ROK-2323). Sent to every
     * viewer so the web can tell a voice row from a server row without the
     * Discord id itself. Absent on legacy payloads.
     */
    hasDiscord: z.boolean().optional(),
    /** SteamID64 of a game-server participant (ROK-1800). Owner/admin only (ROK-2323). */
    steamId: z.string().nullable().optional(),
    /**
     * Platform id of a game-server participant, namespaced by `idKind`
     * (ROK-2232). Set together with `idKind`; a Steam player's equals
     * `steamId`. Absent for a Discord-only row and on legacy payloads.
     * Owner/admin only (ROK-2323), like `idKind`.
     */
    playerId: z.string().optional(),
    /** Namespace of `playerId` (ROK-2232). Set together with `playerId`. */
    idKind: PlayerIdKindEnum.optional(),
    /** Where the participant was first seen (ROK-1800). */
    source: z.enum(['discord', 'steam']).optional(),
    /** Currently in the event's voice channel (ROK-1821). Absent on legacy payloads. */
    inVoice: z.boolean().optional(),
    /** Currently on the linked game server (ROK-1821). Absent on legacy payloads. */
    onServer: z.boolean().optional(),
    /**
     * Display name: Discord username, or character name / SteamID64. A
     * non-owner viewer never receives a raw platform id here — an anonymous
     * server player is sent as `Server player` (ROK-2323).
     */
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
