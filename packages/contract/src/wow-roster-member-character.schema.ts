import { z } from "zod";
import { CharacterSchema } from "./characters.schema.js";
import { GuildMemberPresenceSchema } from "./guilds.schema.js";

/**
 * ROK-2149 — `GET /plugins/wow/guilds/:id/members/:memberId`: a WoW guild
 * roster member that has no Raid Ledger character, shaped like a
 * `CharacterDto` so the existing `CharacterDetailPage` can render it
 * read-only (operator direction 2026-11-09 ~15:25Z).
 *
 * It is NOT a character: `id` is `roster-member:<memberId>` (never a
 * `characters` uuid) and `userId` is null. A client must never call an
 * endpoint keyed by character id with it (`/characters/:id/*`, quests,
 * lockouts, installed addons, guild-by-character, refresh, sync, edit).
 *
 * Sibling schema rather than new optional fields on `CharacterSchema`:
 * `CharacterSchema.id` is a uuid and `userId` an int, so carrying a
 * non-character there would widen two required fields every character
 * reader relies on. Here they are replaced; every other field keeps the
 * `CharacterSchema` shape, so the web normalises with two keys.
 */

/** Prefix of the synthetic `id` — never a characters uuid. */
export const ROSTER_MEMBER_CHARACTER_ID_PREFIX = "roster-member:";

/** D1 — why a member has no Armory data, in precedence order. */
export const RosterMemberNoArmoryReasonSchema = z.enum([
  "no_blizzard_id",
  "below_level_10",
  "invalid_name",
  "not_found",
  "id_mismatch",
  "pending",
]);
export type RosterMemberNoArmoryReason = z.infer<
  typeof RosterMemberNoArmoryReasonSchema
>;

/** The roster rank (members + staff audience only). */
export const RosterMemberRankSchema = z
  .object({
    index: z.number().int().nullable(),
    name: z.string().nullable(),
  })
  .strict();
export type RosterMemberRank = z.infer<typeof RosterMemberRankSchema>;

export const WowRosterMemberCharacterSchema = CharacterSchema.omit({
  id: true,
  userId: true,
  lockouts: true,
  enrichments: true,
})
  .extend({
    /** `roster-member:<memberId>` — NOT a characters uuid. */
    id: z.string().regex(/^roster-member:\d+$/),
    /** Nobody owns a roster member. */
    userId: z.null(),
    readOnly: z.literal(true),
    rosterMemberId: z.number().int().positive(),
    hubId: z.number().int().positive(),
    /** Unclaimed member of a claimable WoW: Forever guild. */
    canClaim: z.boolean(),
    /** Present only when there is no verified Armory snapshot. */
    noArmoryReason: RosterMemberNoArmoryReasonSchema.optional(),
    /** Roster-only (members + staff); the key is absent for claim previews. */
    rank: RosterMemberRankSchema.optional(),
    /** Roster-only presence at the latest export; absent when not reported or for claim previews. */
    lastSeen: GuildMemberPresenceSchema.optional(),
  })
  .strict();
export type WowRosterMemberCharacterDto = z.infer<
  typeof WowRosterMemberCharacterSchema
>;

/** A member a character now claims (members + staff): redirect there. */
export const WowRosterMemberClaimedSchema = z
  .object({
    claimedCharacterId: z.string().uuid(),
    rosterMemberId: z.number().int().positive(),
    hubId: z.number().int().positive(),
  })
  .strict();
export type WowRosterMemberClaimedDto = z.infer<
  typeof WowRosterMemberClaimedSchema
>;

export const WowRosterMemberResponseSchema = z.union([
  WowRosterMemberCharacterSchema,
  WowRosterMemberClaimedSchema,
]);
export type WowRosterMemberResponseDto = z.infer<
  typeof WowRosterMemberResponseSchema
>;
