import { z } from "zod";
import { WowForeverSelectableRulesetSchema } from "./blizzard.schema.js";

/**
 * ROK-2128 — "Add character → Guild roster" for WoW: Forever. A player picks
 * one of the guild's already-imported, unclaimed roster characters and claims
 * it in one click; admins can unlink or change the owner of a wrong claim.
 * Additive only — NOT the LedgerLink wire format (`ledgerlink/v1`).
 */

/** Server cap on candidates returned by one list call (`truncated` when hit). */
export const MAX_ROSTER_CLAIM_CANDIDATES = 1000;

/** `GET /plugins/wow/roster-claim/candidates?gameId=` query. */
export const RosterClaimCandidatesQuerySchema = z.object({
  gameId: z.coerce.number().int().positive(),
});
export type RosterClaimCandidatesQueryDto = z.infer<
  typeof RosterClaimCandidatesQuerySchema
>;

/** One unclaimed roster row (FLAG 2: no rank, note, presence or captor). */
export const RosterClaimCandidateSchema = z.object({
  memberId: z.number().int().positive(),
  name: z.string(),
  class: z.string().nullable(),
  level: z.number().int().nullable(),
  source: z.enum(["addon_import", "blizzard"]),
});
export type RosterClaimCandidateDto = z.infer<typeof RosterClaimCandidateSchema>;

/** One visible guild and its unclaimed candidates. */
export const RosterClaimGuildSchema = z.object({
  guildId: z.number().int().positive(),
  guildName: z.string(),
  region: z.string(),
  candidates: z.array(RosterClaimCandidateSchema),
});
export type RosterClaimGuildDto = z.infer<typeof RosterClaimGuildSchema>;

export const RosterClaimListResponseSchema = z.object({
  guilds: z.array(RosterClaimGuildSchema),
  /** Server cap hit (1000 candidates) — UI says "search to narrow". */
  truncated: z.boolean(),
});
export type RosterClaimListResponseDto = z.infer<
  typeof RosterClaimListResponseSchema
>;

/** `POST /plugins/wow/roster-claim/members/:memberId/claim` body (FLAG 4). */
export const RosterClaimRequestSchema = z.object({
  ruleset: WowForeverSelectableRulesetSchema,
  isMain: z.boolean().optional().default(false),
});
export type RosterClaimRequestDto = z.infer<typeof RosterClaimRequestSchema>;

/** `PUT /admin/plugins/wow/characters/:id/owner` body. */
export const AdminCharacterOwnerRequestSchema = z.object({
  userId: z.number().int().positive(),
});
export type AdminCharacterOwnerRequestDto = z.infer<
  typeof AdminCharacterOwnerRequestSchema
>;

export const AdminCharacterOwnerResultSchema = z.object({
  characterId: z.string().uuid(),
  fromUserId: z.number(),
  toUserId: z.number(),
});
export type AdminCharacterOwnerResultDto = z.infer<
  typeof AdminCharacterOwnerResultSchema
>;
