import { z } from "zod";

/**
 * ROK-1928 — WoW: Forever guild roster from the Blizzard guild roster API.
 * The officer-set Blizzard guild slug (`guilds.guild_slug`) and the last
 * sync's outcome. Not part of the LedgerLink wire format (`ledgerlink/v1/`).
 */

const isoDate = z.iso.datetime({ offset: true });

/** Outcome of the last Blizzard roster sync (`guilds.blizzard_roster_status`). */
export const BLIZZARD_ROSTER_STATUSES = [
  "ok",
  "not_found",
  "error",
  "skipped_empty",
] as const;
export const BlizzardRosterStatusSchema = z.enum(BLIZZARD_ROSTER_STATUSES);
export type BlizzardRosterStatus = z.infer<typeof BlizzardRosterStatusSchema>;

/** Letters, digits and hyphens, 2–64 long (spec A3). */
export const BLIZZARD_GUILD_SLUG_PATTERN = /^[\p{L}\p{N}-]{2,64}$/u;

/** `GuildSummary.blizzardRoster` — sent only on Forever `wow_guild` hubs. */
export const GuildBlizzardRosterSchema = z
  .object({
    guildSlug: z.string().nullable(),
    status: BlizzardRosterStatusSchema.nullable(),
    syncedAt: isoDate.nullable(),
  })
  .strict();
export type GuildBlizzardRoster = z.infer<typeof GuildBlizzardRosterSchema>;

/** `PATCH /plugins/wow/guilds/:id/blizzard-roster` body; null = stop syncing. */
export const GuildBlizzardRosterUpdateSchema = z
  .object({
    guildSlug: z.string().regex(BLIZZARD_GUILD_SLUG_PATTERN).nullable(),
  })
  .strict();
export type GuildBlizzardRosterUpdate = z.infer<
  typeof GuildBlizzardRosterUpdateSchema
>;
