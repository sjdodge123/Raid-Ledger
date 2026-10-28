import { z } from "zod";

/**
 * ROK-1919 — `GET /plugins/wow/guilds/:id/recent-dings`: the WoW: Forever
 * "Recent dings" hub feed. Level-ups seen between two LedgerLink guild
 * exports in the last 30 days, newest first. A multi-level jump is one ding;
 * `at` is when the export was received, not the in-game ding time.
 */
export const MAX_RECENT_DINGS = 50;

const level = z.number().int().min(0).max(100);

export const WowRecentDingSchema = z
  .object({
    name: z.string().max(64),
    /** The linked RL character (`characters.id`), when one carries the GUID. */
    characterId: z.string().uuid().nullable(),
    fromLevel: level,
    toLevel: level,
    at: z.string().datetime(),
  })
  .strict();
export type WowRecentDingDto = z.infer<typeof WowRecentDingSchema>;

export const WowRecentDingsSchema = z
  .object({ dings: z.array(WowRecentDingSchema).max(MAX_RECENT_DINGS) })
  .strict();
export type WowRecentDingsDto = z.infer<typeof WowRecentDingsSchema>;
