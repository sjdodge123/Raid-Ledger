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

/**
 * `GET /plugins/wow/guilds/:id/blizzard-roster` — the stored slug + last sync
 * outcome, plus `suggestedSlug` derived from the guild name (FLAG A-1 prefill).
 */
export const GuildBlizzardRosterViewSchema = GuildBlizzardRosterSchema.extend({
  suggestedSlug: z.string(),
}).strict();
export type GuildBlizzardRosterView = z.infer<
  typeof GuildBlizzardRosterViewSchema
>;

/**
 * A sync's outcome: a stored status, `stale` — the guild already holds a newer
 * roster snapshot — or `superseded` — the guild's Blizzard slug changed while
 * the roster was being fetched. Neither of the last two writes anything or is
 * ever stored as a status (the manual route answers `superseded` with a 409).
 */
export const BlizzardRosterSyncOutcomeSchema = z.enum([
  ...BLIZZARD_ROSTER_STATUSES,
  "stale",
  "superseded",
]);
export type BlizzardRosterSyncOutcome = z.infer<
  typeof BlizzardRosterSyncOutcomeSchema
>;

/**
 * `POST /plugins/wow/guilds/:id/blizzard-roster/sync` (ROK-1928 C3) — the
 * manual run's outcome; `members` = roster rows the sync applied (0 when stale).
 */
export const GuildBlizzardRosterSyncResultSchema = z
  .object({
    status: BlizzardRosterSyncOutcomeSchema,
    syncedAt: isoDate.nullable(),
    members: z.number().int().nonnegative(),
  })
  .strict();
export type GuildBlizzardRosterSyncResult = z.infer<
  typeof GuildBlizzardRosterSyncResultSchema
>;
