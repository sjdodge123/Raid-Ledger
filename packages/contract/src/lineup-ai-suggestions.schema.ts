import { z } from 'zod';

/**
 * Single AI-generated suggestion shown on a lineup (ROK-931).
 *
 * Produced by `GET /lineups/:id/suggestions`. The server enriches each
 * LLM pick with the same metadata that Common Ground rows carry
 * (player count, wishlist, pricing, ITAD tags, early-access flag) so
 * the UI can render a suggestion inside the Common Ground grid with
 * full badge parity and just layer the ✨ AI chip on top.
 */
export const AiSuggestionSchema = z.object({
  gameId: z.number().int(),
  name: z.string(),
  slug: z.string(),
  coverUrl: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(280),
  /** Number of voters (of `voterTotal`) who own this game on Steam. Used as LLM prompt signal. */
  ownershipCount: z.number().int().min(0),
  voterTotal: z.number().int().min(0),
  /** Community-wide Steam ownership count — matches Common Ground's ownerCount badge. */
  communityOwnerCount: z.number().int().min(0),
  /** Community-wide wishlist count (Steam wishlist joins). */
  wishlistCount: z.number().int().min(0),
  /** Current ITAD price for non-owners; null when no ITAD data. */
  nonOwnerPrice: z.number().nullable(),
  /** Current sale percentage (0-100); null when not on sale. */
  itadCurrentCut: z.number().nullable(),
  itadCurrentShop: z.string().nullable(),
  itadCurrentUrl: z.string().nullable(),
  earlyAccess: z.boolean(),
  itadTags: z.array(z.string()),
  playerCount: z
    .object({ min: z.number(), max: z.number() })
    .nullable(),
});
export type AiSuggestionDto = z.infer<typeof AiSuggestionSchema>;

/**
 * Response shape for `GET /lineups/:id/suggestions`.
 *
 * `cached: true` when served from `lineup_ai_suggestions`; `false` when
 * freshly generated during this request. `voterScopeStrategy` reflects
 * the LLM prompt variant chosen based on voter count (see spec
 * "Scaling by Voter Count").
 */
export const AiSuggestionsResponseSchema = z.object({
  suggestions: z.array(AiSuggestionSchema),
  generatedAt: z.string(),
  voterCount: z.number().int().min(0),
  voterScopeStrategy: z.enum(['community', 'partial', 'small_group']),
  cached: z.boolean(),
});
export type AiSuggestionsResponseDto = z.infer<
  typeof AiSuggestionsResponseSchema
>;

/**
 * Strict JSON shape we ask the LLM to produce. Server adds the rest of
 * `AiSuggestionDto` fields via a post-parse enrichment pass.
 *
 * Cap of 10 items enforced at parse time; additional items are
 * truncated silently. Unknown `gameId`s are dropped after parse.
 */
export const AiSuggestionsLlmOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        gameId: z.number().int(),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().min(1).max(280),
      }),
    )
    .max(10),
});
export type AiSuggestionsLlmOutputDto = z.infer<
  typeof AiSuggestionsLlmOutputSchema
>;
