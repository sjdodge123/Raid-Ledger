/**
 * Common Ground theme classifier + whyReason builder (ROK-1297 S1).
 *
 * `classifyTheme` projects the score breakdown onto the three Nominating-
 * composite rows (Owned / Taste / Trending). `buildWhyReason` produces the
 * short human-readable rationale that surfaces under each tile. Templates
 * mirror the spec's "Why-reason templates" table; all output is capped at
 * 80 characters to satisfy the Zod `whyReason: z.string().max(80)` field.
 */
import type {
  CommonGroundGameDto,
  CommonGroundScoreBreakdownDto,
  CommonGroundTheme,
} from '@raid-ledger/contract';

/** Per-tile signal context the response builder collects once per game. */
export interface WhyReasonContext {
  ownerCount: number;
  topGenres?: string[];
  itadCurrentCut?: number | null;
  wishlistCount?: number;
}

/**
 * Map a tile onto its dominant themed row.
 *
 * Operator iteration log (2026-05-18):
 *   - Round 1: socialScore-only. Owned row stayed empty whenever the
 *     viewer had no co-play graph, even with 15+ guildmates owning the
 *     game.
 *   - Round 3a: added `ownerCount >= 2 → owned` fallback. Fixed the
 *     empty Owned row but swept EVERY tile (including on-sale ones)
 *     into Owned, leaving Trending empty.
 *   - Round 3b (this version): on-sale tiles ALWAYS land in Trending
 *     (operators expect deals there), regardless of guild ownership.
 *     Tiles fall to Owned only when no sale signal AND no co-play
 *     signal AND ownerCount >= 2.
 *
 * Resulting priority:
 *   1. Strong co-play match (socialScore > 0 AND socialScore > taste) → owned
 *   2. Taste-vector match (tasteScore > 0)                            → taste
 *   3. On sale / free (itadCurrentCut > 0)                            → trending
 *   4. Guild owns ≥ 2 with none of the above                          → owned
 *   5. Default                                                        → trending
 */
export function classifyTheme(
  breakdown: CommonGroundScoreBreakdownDto,
  ownerCount: number = 0,
  itadCurrentCut: number | null = null,
): CommonGroundTheme {
  const social = breakdown.socialScore;
  const taste = breakdown.tasteScore;
  // Strong co-play match outranks everything (matches the wishlist + sale
  // signals are noisier than "your friends own this together").
  if (social > 0 && social > taste) return 'owned';
  if (taste > 0) return 'taste';
  // On-sale / free → trending. Operators expect deals to show up under
  // "Trending or on sale" regardless of who else owns the game.
  if (itadCurrentCut != null && itadCurrentCut > 0) return 'trending';
  // No sale signal, no co-play, no taste — but the guild does own this.
  if (ownerCount >= 2) return 'owned';
  return 'trending';
}

/** Cap a string at 80 chars (Zod ceiling for whyReason). */
function capAt80(s: string): string {
  return s.length <= 80 ? s : s.slice(0, 80);
}

/** True when the cut/price combo reads as "free". */
function isFree(cut: number | null | undefined): boolean {
  return cut != null && cut >= 100;
}

/** True when there is a non-free sale modifier on the tile. */
function hasSale(cut: number | null | undefined): boolean {
  return cut != null && cut > 0 && cut < 100;
}

function buildOwnedReason(ctx: WhyReasonContext): string {
  if (isFree(ctx.itadCurrentCut)) {
    return capAt80(`${ctx.ownerCount} own · Free`);
  }
  if (hasSale(ctx.itadCurrentCut)) {
    return capAt80(`${ctx.ownerCount} of you own · ${ctx.itadCurrentCut}% off`);
  }
  return capAt80(`${ctx.ownerCount} of you own this`);
}

function buildTasteReason(ctx: WhyReasonContext): string {
  const genres = (ctx.topGenres ?? []).slice(0, 2);
  if (genres.length === 0) {
    return capAt80('Matches your taste');
  }
  return capAt80(`Matches your ${genres.join('/')} cluster`);
}

function buildTrendingReason(ctx: WhyReasonContext): string {
  if (hasSale(ctx.itadCurrentCut) || isFree(ctx.itadCurrentCut)) {
    return capAt80(
      `On sale ${ctx.itadCurrentCut}% off · ${ctx.ownerCount} own`,
    );
  }
  if (ctx.wishlistCount != null && ctx.wishlistCount > 0) {
    return capAt80(`Wishlisted by ${ctx.wishlistCount} · launches soon`);
  }
  return capAt80('Trending in your guild');
}

/** Build the short rationale string surfaced under each Common Ground tile. */
export function buildWhyReason(
  _game: CommonGroundGameDto,
  theme: CommonGroundTheme,
  context: WhyReasonContext,
): string {
  if (theme === 'owned') return buildOwnedReason(context);
  if (theme === 'taste') return buildTasteReason(context);
  return buildTrendingReason(context);
}
