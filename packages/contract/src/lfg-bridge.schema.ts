import { z } from 'zod';

// ============================================================
// Lineup → LFG bridge (ROK-1457)
// ============================================================
//
// When a lineup closes, nominators of games that did NOT win are OFFERED LFG
// — never seeded into it. `GET /lfg/bridge/:lineupId` returns the caller's
// own open offers, recomputed live: once the caller raises a hand on a game
// (`POST /lfg`) that game drops out of the list on the next read.

/** One losing nomination the caller can turn into an LFG intent with one tap. */
export const LfgBridgeOfferSchema = z.object({
    gameId: z.number().int().positive(),
    gameName: z.string(),
    gameSlug: z.string(),
    gameCoverUrl: z.string().nullable(),
    lineupId: z.number().int().positive(),
    lineupTitle: z.string(),
});
export type LfgBridgeOfferDto = z.infer<typeof LfgBridgeOfferSchema>;

/** Response shape of `GET /lfg/bridge/:lineupId`. */
export const LfgBridgeOffersResponseSchema = z.array(LfgBridgeOfferSchema);
export type LfgBridgeOffersResponseDto = z.infer<
    typeof LfgBridgeOffersResponseSchema
>;
