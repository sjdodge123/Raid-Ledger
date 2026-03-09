import { z } from 'zod';

// ==========================================
// Steam Integration (ROK-417)
// ==========================================

/**
 * Steam profile summary from ISteamUser/GetPlayerSummaries.
 */
export const SteamProfileSchema = z.object({
  steamId: z.string(),
  personaName: z.string(),
  avatarUrl: z.string().nullable(),
  profileUrl: z.string(),
  /** 1=private, 2=friendsonly, 3=public */
  communityVisibilityState: z.number().int(),
});

export type SteamProfileDto = z.infer<typeof SteamProfileSchema>;

/**
 * A single game from Steam's GetOwnedGames response.
 */
export const SteamOwnedGameSchema = z.object({
  appId: z.number().int(),
  name: z.string(),
  playtimeForever: z.number().int(),
  playtime2weeks: z.number().int().optional(),
  imgIconUrl: z.string().optional(),
});

export type SteamOwnedGameDto = z.infer<typeof SteamOwnedGameSchema>;

/**
 * Result of a Steam library sync operation.
 */
export const SteamSyncResultSchema = z.object({
  totalOwned: z.number().int(),
  matched: z.number().int(),
  newInterests: z.number().int(),
  updatedPlaytime: z.number().int(),
  /** Number of games imported from IGDB during backfill. */
  imported: z.number().int().optional(),
});

export type SteamSyncResultDto = z.infer<typeof SteamSyncResultSchema>;

/**
 * Steam link status for user profile.
 */
export const SteamLinkStatusSchema = z.object({
  linked: z.boolean(),
  steamId: z.string().nullable(),
  personaName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  lastSyncedAt: z.string().datetime().nullable().optional(),
});

export type SteamLinkStatusDto = z.infer<typeof SteamLinkStatusSchema>;

/**
 * Admin Steam configuration status.
 */
export const SteamConfigStatusSchema = z.object({
  configured: z.boolean(),
});

export type SteamConfigStatusDto = z.infer<typeof SteamConfigStatusSchema>;
