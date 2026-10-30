import { z } from "zod";

/**
 * ROK-1917 (W10 "Raid progress") — the members-only raid-progress section of
 * `GET /plugins/wow/guilds/:id/roster-insights`, built from the boss pulls
 * LedgerLink raid exports store. One row per `(encounter, difficulty)`: first
 * kill, kills and wipes. Never carries a pull's roster (no player names).
 */

/** Most boss rows the payload carries (a full Classic + Forever clear is ~40). */
export const MAX_RAID_PROGRESS_BOSSES = 60;

const count = z.number().int().nonnegative();
const iso = z.iso.datetime({ offset: true });

export const WowRosterRaidProgressBossSchema = z
  .object({
    encounterId: z.number().int().nonnegative(),
    difficultyId: z.number().int().nonnegative(),
    /** Display label for the difficulty; null when the id is not mapped. */
    difficultyLabel: z.string().max(64).nullable(),
    name: z.string().max(128),
    /** Earliest successful pull's end time; null when never killed. */
    firstKillAt: iso.nullable(),
    kills: count,
    wipes: count,
    /** End time of the latest pull of this boss. */
    lastPullAt: iso,
  })
  .strict();
export type WowRosterRaidProgressBossDto = z.infer<
  typeof WowRosterRaidProgressBossSchema
>;

export const WowRosterRaidProgressSchema = z
  .object({
    /** Killed first (by first kill), then unkilled (most wipes first). */
    bosses: z
      .array(WowRosterRaidProgressBossSchema)
      .max(MAX_RAID_PROGRESS_BOSSES),
    /** Bosses with at least one kill (over every boss, not just `bosses`). */
    killedCount: count,
    /** Pulls after the near-duplicate collapse. */
    pullCount: count,
    /** The latest pull's end time; null when the guild has no pulls. */
    lastPullAt: iso.nullable(),
  })
  .strict();
export type WowRosterRaidProgressDto = z.infer<
  typeof WowRosterRaidProgressSchema
>;
