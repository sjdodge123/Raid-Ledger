/**
 * Common Ground presentation helpers — response-shaping concerns split out
 * of `common-ground-query.helpers.ts` (ROK-1314) to keep that file under the
 * 300-line cap. Pure functions only: no DB access.
 */
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import type { CommonGroundWeights } from './common-ground-scoring.constants';
import { classifyTheme, buildWhyReason } from './common-ground-theme.helpers';

/** Shape the meta.appliedWeights subobject from raw weights. */
export function toAppliedWeights(weights: CommonGroundWeights) {
  return {
    ownerWeight: weights.ownerWeight,
    saleBonus: weights.saleBonus,
    fullPricePenalty: weights.fullPricePenalty,
    tasteWeight: weights.tasteWeight,
    socialWeight: weights.socialWeight,
    intensityWeight: weights.intensityWeight,
  };
}

/**
 * Augment a scored game with the ROK-1297 themed-row classification +
 * human-readable rationale. Skipped when the breakdown isn't available
 * (legacy callers without a scoring context) so the additive fields stay
 * truly optional. Both fields are set together or not at all.
 */
export function withThemeAndWhyReason(
  game: CommonGroundGameDto,
): CommonGroundGameDto {
  if (!game.scoreBreakdown) return game;
  const theme = classifyTheme(
    game.scoreBreakdown,
    game.ownerCount,
    game.itadCurrentCut,
  );
  const whyReason = buildWhyReason(game, theme, {
    ownerCount: game.ownerCount,
    topGenres: game.itadTags.slice(0, 2),
    itadCurrentCut: game.itadCurrentCut,
    wishlistCount: game.wishlistCount,
  });
  return { ...game, theme, whyReason };
}

/**
 * ROK-1297 invariant: every response game has BOTH `theme` + `whyReason`
 * set or BOTH absent. Runtime assertion at the end of the pipe so a
 * future regression on either path fails fast in dev/CI rather than
 * silently leaking half-themed tiles to the client.
 */
export function assertThemePairing(games: CommonGroundGameDto[]): void {
  for (const g of games) {
    const themed = g.theme !== undefined;
    const reasoned = g.whyReason !== undefined;
    if (themed !== reasoned) {
      throw new Error(
        `ROK-1297 invariant violated: gameId=${g.gameId} has theme=${
          g.theme ?? 'undefined'
        } but whyReason=${g.whyReason === undefined ? 'undefined' : '<set>'}`,
      );
    }
  }
}
