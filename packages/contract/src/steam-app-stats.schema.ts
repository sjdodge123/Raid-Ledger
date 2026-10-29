import { z } from 'zod';

/**
 * ROK-1953 §3.1 — the shared Steam achievements + playtime cards (Core plugin),
 * keyed by the hub game's Steam app id. Served by `GET /hubs/:guildId/steam-stats`.
 * Hidden achievements are masked per viewer server-side: a masked entry carries
 * only its global %, never its api name, name or description. No icon on the
 * wire in v1 (text-only ruling). Not part of the LedgerLink wire format.
 */

/** A Steam global unlock percentage, 0–100. */
const PctSchema = z.number().min(0).max(100);
const IsoDateTimeSchema = z.string().datetime();

/** A member's Steam stats state for the hub's app. */
export const STEAM_STATS_STATUSES = [
  'ok',
  'private',
  'not_owned',
  'pending',
  'unlinked',
  'error',
] as const;
export const SteamStatsStatusSchema = z.enum(STEAM_STATS_STATUSES);
export type SteamStatsStatus = z.infer<typeof SteamStatsStatusSchema>;

/** A hidden achievement the viewer has not earned: only its rarity is shown. */
export const SteamAchievementMaskedSchema = z
  .object({ masked: z.literal(true), globalPct: PctSchema.nullable() })
  .strict();

export const SteamAchievementFullSchema = z
  .object({
    masked: z.literal(false),
    apiName: z.string().min(1).max(128),
    name: z.string(),
    description: z.string().nullable(),
    hidden: z.boolean(),
    globalPct: PctSchema.nullable(),
  })
  .strict();

export const SteamAchievementViewSchema = z.discriminatedUnion('masked', [
  SteamAchievementMaskedSchema,
  SteamAchievementFullSchema,
]);
export type SteamAchievementView = z.infer<typeof SteamAchievementViewSchema>;

export const SteamHubMemberStatsSchema = z
  .object({
    userId: z.number().int().positive(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    status: SteamStatsStatusSchema,
    /** `null` unless `status` is `ok`. */
    unlockedCount: z.number().int().min(0).nullable(),
    playtimeMinutes: z.number().int().min(0).nullable(),
    fetchedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type SteamHubMemberStats = z.infer<typeof SteamHubMemberStatsSchema>;

export const SteamHubUnlockSchema = z
  .object({
    userId: z.number().int().positive(),
    unlockedAt: IsoDateTimeSchema,
    achievement: SteamAchievementViewSchema,
  })
  .strict();
export type SteamHubUnlock = z.infer<typeof SteamHubUnlockSchema>;

/** The most recent unlocks a hub shows. */
export const STEAM_HUB_RECENT_UNLOCKS_MAX = 8;

const SteamHubStatsUnavailableSchema = z
  .object({ available: z.literal(false) })
  .strict();

const SteamHubStatsAvailableSchema = z
  .object({
    available: z.literal(true),
    appId: z.number().int().positive(),
    totalAchievements: z.number().int().min(0),
    viewer: z.object({ status: SteamStatsStatusSchema }).strict(),
    /** `unlockedCount` desc, nulls last, then display name. */
    members: z.array(SteamHubMemberStatsSchema),
    recentUnlocks: z.array(SteamHubUnlockSchema).max(STEAM_HUB_RECENT_UNLOCKS_MAX),
    rarestUnlock: SteamHubUnlockSchema.nullable(),
    refreshedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();

/** `{ available: false }` = the hub's game is not enabled for Steam stats (D9). */
export const SteamHubStatsResponseSchema = z.discriminatedUnion('available', [
  SteamHubStatsUnavailableSchema,
  SteamHubStatsAvailableSchema,
]);
export type SteamHubStatsResponse = z.infer<typeof SteamHubStatsResponseSchema>;
