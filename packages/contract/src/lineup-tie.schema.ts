/**
 * ROK-1374 — the tie hold + the readiness card (contract).
 *
 * A completed vote with no decidable winner parks the lineup on a tie hold and
 * the group compares the tied games on the readiness card. The card is a
 * decision AID: it reports ownership, footprint and a personal download
 * estimate. It never selects a winner — the pick is always a human clicking a
 * game (operator answers Q1–Q3, 2026-09-03).
 *
 * Deliberately a separate file from `lineup-tiebreaker.schema.ts` (91 counted
 * lines, close enough to the 300-line cap that adding the readiness surface
 * there would force an extraction later).
 */
import { z } from 'zod';

// ============================================================
// Enums
// ============================================================

/**
 * Derived server-side from `tie_detected_at` / `tie_pick_at` /
 * `tie_expired_at` on every read. NEVER stored as a column: a `tie_status`
 * column would be a second source of truth and would drift from the three
 * timestamps that actually define the state.
 */
export const TieHoldStatusSchema = z.enum([
    'none',
    'awaiting_pick',
    'picked',
    'expired',
]);
export type TieHoldStatus = z.infer<typeof TieHoldStatusSchema>;

/**
 * Matches the documented values of `games.install_size_source`.
 * `steam_depot` is reserved but unwritten — automatic depot resolution is a
 * later story, and reserving the value here means it lands without a migration.
 */
export const InstallSizeSourceSchema = z.enum(['steam_depot', 'manual']);
export type InstallSizeSource = z.infer<typeof InstallSizeSourceSchema>;

/** How a user's downstream figure was obtained. */
export const ConnectionSpeedSourceSchema = z.enum(['ndt7', 'manual']);
export type ConnectionSpeedSource = z.infer<typeof ConnectionSpeedSourceSchema>;

// ============================================================
// Readiness card
// ============================================================

/**
 * One roster member's wait for one tied game.
 *
 * Operator ruling (2026-09-05): a group decides a tie together, so the card
 * names everyone on the roster and what each of them is in for. Sharing is a
 * SEPARATE opt-in from the speed test itself and is OFF by default —
 * `not_shared` is the honest default, not an error.
 *
 * `estimatedDownloadMinutes` is non-null only for `status: 'eta'`. Minutes are
 * the ONLY derived figure that crosses the wire for another member: their
 * Mbps, its source and when it was measured stay self-scoped (AC20).
 */
export const RosterEtaStatusSchema = z.enum([
    /** Shared (or the viewer's own line) and a wait could be computed. */
    'eta',
    /** Shared, but no speed figure or no known size — nothing to compute. */
    'no_speed',
    /** Has not opted in to sharing. The default. */
    'not_shared',
]);
export type RosterEtaStatus = z.infer<typeof RosterEtaStatusSchema>;

export const RosterEtaSchema = z.object({
    userId: z.number(),
    displayName: z.string(),
    /** The viewer's own line, which uses their speed even when unshared. */
    isViewer: z.boolean(),
    status: RosterEtaStatusSchema,
    estimatedDownloadMinutes: z.number().nullable(),
});
export type RosterEtaDto = z.infer<typeof RosterEtaSchema>;

/**
 * One tied game, as the viewer sees it.
 *
 * `ownedCount` is scoped to the lineup roster, never the whole community —
 * a community-wide count answers a question nobody asked and inflates every
 * row (AC11).
 */
export const TieReadinessGameSchema = z.object({
    gameId: z.number(),
    gameName: z.string(),
    gameCoverUrl: z.string().nullable(),
    voteCount: z.number(),
    steamAppId: z.number().nullable(),
    /** Roster members who own it (`game_interests.source = 'steam_library'`). */
    ownedCount: z.number(),
    rosterSize: z.number(),
    youOwn: z.boolean(),
    installSizeBytes: z.number().nullable(),
    downloadSizeBytes: z.number().nullable(),
    installSizeSource: InstallSizeSourceSchema.nullable(),
    /** Drives the "entered 3 months ago" provenance line (AC12). */
    installSizeUpdatedAt: z.string().nullable(),
    /**
     * Null whenever either input (download size, viewer speed) is missing —
     * NEVER 0. A zero would render as "~0 min", which reads as "instant"
     * rather than "unknown".
     */
    estimatedDownloadMinutes: z.number().nullable(),
    /**
     * Every roster member, in roster order, with the wait each of them is in
     * for. Members who have not opted in appear as `not_shared` — they are
     * still named, because "who have we not heard from" is part of the
     * decision.
     */
    rosterEtas: z.array(RosterEtaSchema),
});
export type TieReadinessGameDto = z.infer<typeof TieReadinessGameSchema>;

/** The human pick. `finalAt` is when the grace claim advances it to decided. */
export const TiePickSchema = z.object({
    gameId: z.number(),
    at: z.string(),
    byUserId: z.number(),
    byUsername: z.string(),
    finalAt: z.string(),
});
export type TiePickDto = z.infer<typeof TiePickSchema>;

/**
 * The whole card. Personalized (`youOwn`, `viewerSpeedMbps`,
 * `estimatedDownloadMinutes`), which is exactly why it cannot be a Discord
 * channel embed — ROK-1449 requires a channel embed to render identically for
 * every viewer.
 */
export const TieReadinessResponseSchema = z.object({
    lineupId: z.number(),
    status: TieHoldStatusSchema,
    voteCount: z.number(),
    games: z.array(TieReadinessGameSchema),
    rosterSize: z.number(),
    expiresAt: z.string().nullable(),
    pick: TiePickSchema.nullable(),
    /** Creator or operator/admin only — everyone else reads the comparison. */
    canPick: z.boolean(),
    pickerName: z.string().nullable(),
    viewerSpeedMbps: z.number().nullable(),
    viewerSpeedMeasuredAt: z.string().nullable(),
});
export type TieReadinessResponseDto = z.infer<
    typeof TieReadinessResponseSchema
>;

// ============================================================
// Requests
// ============================================================

/**
 * The pick is a GAME, not a tiebreaker mode. An elimination-shaped mechanism
 * (bracket / veto) fails the abundance case the readiness card exists for:
 * everybody would be happy with either game and there is nothing to eliminate.
 */
export const PickTiebreakerSchema = z.object({
    gameId: z.number().int().positive(),
});
export type PickTiebreakerDto = z.infer<typeof PickTiebreakerSchema>;

/** 4 TB ceiling — larger than any shipped game, small enough to catch a typo. */
const MAX_SIZE_BYTES = 4_000_000_000_000;

/**
 * Community-shared, entered by hand from the SteamDB depots page. The value is
 * read there by a human and typed here — this app never fetches SteamDB.
 */
export const SetInstallSizeSchema = z
    .object({
        installSizeBytes: z
            .number()
            .int()
            .positive()
            .max(MAX_SIZE_BYTES)
            .nullable(),
        downloadSizeBytes: z
            .number()
            .int()
            .positive()
            .max(MAX_SIZE_BYTES)
            .nullable(),
    })
    .refine(
        (v) => v.installSizeBytes !== null || v.downloadSizeBytes !== null,
        { message: 'At least one of installSizeBytes/downloadSizeBytes is required' },
    )
    .refine(
        (v) =>
            v.installSizeBytes === null ||
            v.downloadSizeBytes === null ||
            v.downloadSizeBytes <= v.installSizeBytes,
        { message: 'downloadSizeBytes cannot exceed installSizeBytes' },
    );
export type SetInstallSizeDto = z.infer<typeof SetInstallSizeSchema>;

// ============================================================
// Connection speed (per-user, private)
// ============================================================

/**
 * The viewer's own figure. Never returned for another user, never in an embed
 * or a DM. These four values are the ONLY things persisted from a speed test —
 * no M-Lab server names, no latency series, no IP-adjacent diagnostics (AC20).
 */
export const ConnectionSpeedSchema = z.object({
    downstreamMbps: z.number().positive().max(10_000).nullable(),
    /**
     * Nullable, unlike the spec table: a user who has never measured has a
     * speed row of all nulls, and GET /users/me/connection-speed must be able
     * to say so rather than 404 or invent a source.
     */
    source: ConnectionSpeedSourceSchema.nullable(),
    measuredAt: z.string().nullable(),
    consentAt: z.string().nullable(),
    /**
     * Null = the ETA is not shared with lineup rosters. A SEPARATE consent
     * from `consentAt`, default OFF; revoking the speed-test consent clears
     * it too, because the datum it would share is gone.
     */
    shareEtaAt: z.string().nullable(),
});
export type ConnectionSpeedDto = z.infer<typeof ConnectionSpeedSchema>;

/** 10 Gbps ceiling — above any residential line, so it only catches garbage. */
export const SetConnectionSpeedSchema = z.object({
    downstreamMbps: z.number().positive().max(10_000),
    source: ConnectionSpeedSourceSchema,
});
export type SetConnectionSpeedDto = z.infer<typeof SetConnectionSpeedSchema>;

/** `consent:false` deletes the datum, not just the permission (AC21 / E19). */
export const SetSpeedTestConsentSchema = z.object({
    consent: z.boolean(),
    /**
     * Optional: set the roster-sharing flag in the same call the user grants
     * consent from. Omitted leaves it untouched; `consent:false` clears it
     * regardless, since the datum it would share is deleted.
     */
    shareEta: z.boolean().optional(),
});
export type SetSpeedTestConsentDto = z.infer<typeof SetSpeedTestConsentSchema>;

/**
 * "Share my download ETA with lineup rosters" — its own switch, default OFF.
 * Turning it on shares MINUTES on the readiness card of any lineup roster the
 * user is on. It never shares the Mbps figure (AC20).
 */
export const SetDownloadEtaSharingSchema = z.object({
    share: z.boolean(),
});
export type SetDownloadEtaSharingDto = z.infer<
    typeof SetDownloadEtaSharingSchema
>;
