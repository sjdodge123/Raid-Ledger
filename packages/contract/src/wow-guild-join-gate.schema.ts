import { z } from "zod";
import { GuildCrestSchema } from "./guild-crest.schema.js";

/**
 * ROK-2132 — the WoW: Forever guild join gate. A non-member opening a
 * Forever guild hub gets a 403 carrying `HUB_NOT_MEMBER`; the web asks
 * `GET /plugins/wow/guilds/:id/join-gate` for the few public facts the gate
 * shows (Ruling 1: crest, name, realm, region, member count — no roster, rank,
 * MOTD, event or post data). Additive only.
 */

/** 403 body `code` of a members-only hub page refused to a non-member (Ruling 8). */
export const HUB_NOT_MEMBER = "HUB_NOT_MEMBER";

const id = z.number().int().positive();

/** The guild facts a non-member may see (Ruling 1). */
export const WowGuildJoinGateGuildSchema = z
  .object({
    id,
    gameId: id,
    name: z.string(),
    region: z.string(),
    realmName: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    /** Same shape as `GuildSummary.crest`; null = initials. */
    crest: GuildCrestSchema.nullable(),
  })
  .strict();
export type WowGuildJoinGateGuild = z.infer<typeof WowGuildJoinGateGuildSchema>;

/** `GET /plugins/wow/guilds/:id/join-gate` response (Ruling 7). */
export const WowGuildJoinGateSchema = z
  .object({
    guild: WowGuildJoinGateGuildSchema,
    viewer: z
      .object({
        /** Already a member (claimed in another tab) — the web skips the gate. */
        isMember: z.boolean(),
        /** Owns ≥1 WoW: Forever character — shows the not-on-roster hint (Ruling 5). */
        hasForeverCharacter: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type WowGuildJoinGateDto = z.infer<typeof WowGuildJoinGateSchema>;
