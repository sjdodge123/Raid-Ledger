/**
 * ROK-1447 — the Quick Play badge vocabulary, mirrored from the web.
 *
 * Two helpers, each a case-for-case port of the web helper that owns the same
 * copy, so the two surfaces can never drift:
 *
 *   `coopBadge`  mirrors `web/src/lib/coop-label.ts::coopLabel`
 *   `priceBadge` mirrors `web/src/components/games/price-badge.helpers.ts::getPriceBadgeType`
 *
 * Two differences, both forced by the data source: the inputs are raw `games`
 * COLUMNS rather than DTOs (so the ITAD `numeric` prices arrive as STRINGS and
 * must be `Number()`-compared), and `priceBadge` takes an explicit `now` so the
 * staleness marker is testable without faking the clock.
 *
 * Both return `null` when there is nothing to say — the caller then renders NO
 * field at all, never a placeholder (spec `planning-artifacts/specs/ROK-1447.md`
 * §Shape, AC3, AC4).
 */

/** How old a price check may be before it is marked stale. */
export const PRICE_BADGE_STALE_MS = 24 * 60 * 60 * 1000;

const PEOPLE = '\u{1F465}'; // 👥
const LABEL = '\u{1F3F7}'; // 🏷
const WARNING = '⚠'; // ⚠
const MINUS = '−'; // − (a real minus sign, not a hyphen)
const SEP = '·'; // ·

/** One inline embed field: a fixed name and its rendered value. */
export interface EmbedBadge {
  name: string;
  value: string;
}

/**
 * The `games` columns the two badges read, exactly as they are selected.
 *
 * Every field is optional and nullable: a game may have no ITAD row, no
 * Co-Optimus row, or neither, and the projection carries the nulls through.
 */
export interface GameBadgeInputs {
  isFreeToPlay?: boolean | null;
  /** `numeric` → string. */
  itadCurrentPrice?: string | null;
  itadCurrentCut?: number | null;
  itadCurrentShop?: string | null;
  itadCurrentUrl?: string | null;
  /** `numeric` → string. */
  itadLowestPrice?: string | null;
  itadPriceUpdatedAt?: Date | null;
  cooptimusOnlineMax?: number | null;
  cooptimusCouchMax?: number | null;
  cooptimusComboCoop?: boolean | null;
}

/** A finite number at or above `floor`, else null (mirrors `coop-label.ts`). */
function atLeast(
  value: number | null | undefined,
  floor: number,
): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= floor
    ? value
    : null;
}

/**
 * Drop a leading glyph (and the space after it) from mirrored copy.
 *
 * The field NAME already carries the glyph, so repeating it in the value
 * renders it twice in one field. Only the decoration comes off: the words are
 * still the mirrored helper's, so the vocabulary cannot drift.
 *
 * @param label - The mirrored copy, e.g. `👥 5 online co-op`.
 * @param glyph - The glyph to drop when it leads the label.
 * @returns The label without its leading `{glyph} `, unchanged otherwise.
 */
function stripLeadingGlyph(label: string, glyph: string): string {
  return label.startsWith(`${glyph} `) ? label.slice(glyph.length + 1) : label;
}

/**
 * The co-op badge for a game, or null when Co-Optimus makes no claim.
 *
 * Priority is strict — combo > online > local — and the thresholds are
 * asymmetric (online at `>= 1`, couch at `>= 2`), exactly as `coopLabel`.
 * IGDB's `playerCount` is NEVER consulted: a lobby size is not a co-op
 * capability.
 *
 * @param game - The selected badge columns.
 * @returns `{ name: '👥 Co-op', value: '5 online co-op' }`, or null. The value
 *   is `coopLabel`'s copy verbatim minus its leading glyph — see
 *   `stripLeadingGlyph`.
 */
export function coopBadge(game: GameBadgeInputs): EmbedBadge | null {
  const onlineMax = atLeast(game.cooptimusOnlineMax, 1);
  const couchMax = atLeast(game.cooptimusCouchMax, 2);
  const count = onlineMax ?? couchMax;
  const kind =
    game.cooptimusComboCoop === true
      ? 'combo'
      : onlineMax != null
        ? 'online'
        : couchMax != null
          ? 'local'
          : null;
  if (kind == null) return null;
  // `coopLabel`'s output, word for word, so the two surfaces cannot drift.
  const label =
    count == null
      ? `${PEOPLE} ${kind} co-op`
      : `${PEOPLE} ${String(count)} ${kind} co-op`;
  return {
    name: `${PEOPLE} Co-op`,
    value: stripLeadingGlyph(label, PEOPLE),
  };
}

/** Whole days between two instants, floored, never below 1. */
function wholeDaysAgo(checkedAt: Date, now: number): number {
  return Math.max(
    1,
    Math.floor((now - checkedAt.getTime()) / (24 * 3_600_000)),
  );
}

/** ` ⚠ checked N days ago`, or `''` while the check is fresh or unknown. */
function stalenessMarker(game: GameBadgeInputs, now: number): string {
  const checkedAt = game.itadPriceUpdatedAt;
  // A missing timestamp is "unknown age", not "known to be stale" — marking it
  // would put a warning on every freshly imported row.
  if (!checkedAt) return '';
  if (now - checkedAt.getTime() <= PRICE_BADGE_STALE_MS) return '';
  const days = wholeDaysAgo(checkedAt, now);
  return ` ${WARNING} checked ${String(days)} day${days === 1 ? '' : 's'} ago`;
}

/** `−50% · $29.99`, masked into a link to the deal when we have a URL. */
function dealText(game: GameBadgeInputs, price: number): string {
  const body = `${MINUS}${String(game.itadCurrentCut)}% ${SEP} $${price.toFixed(2)}`;
  return game.itadCurrentUrl ? `[${body}](${game.itadCurrentUrl})` : body;
}

/**
 * The price badge for a game, or null when there is no deal worth advertising.
 *
 * Mirrors `getPriceBadgeType`: a live discount reads `Best Price` when the
 * current price is at or below the historical low, else `On Sale`. A
 * free-to-play game never gets one — a discount on a game that costs nothing is
 * noise, not news.
 *
 * @param game - The selected badge columns.
 * @param now - Epoch ms, used only for the 24h staleness marker.
 * @returns `{ name: '🏷 On Sale', value: '[−50% · $29.99](url)' }`, or null.
 */
export function priceBadge(
  game: GameBadgeInputs,
  now: number,
): EmbedBadge | null {
  if (game.isFreeToPlay) return null;
  const cut = game.itadCurrentCut;
  if (cut == null || cut <= 0) return null;
  if (game.itadCurrentPrice == null) return null;
  const price = Number(game.itadCurrentPrice);
  if (!Number.isFinite(price)) return null;

  // The columns are `numeric` → STRING: '9.99' > '14.99' lexically, so the
  // comparison has to be numeric or a best price reads as a plain sale.
  const lowest =
    game.itadLowestPrice == null ? null : Number(game.itadLowestPrice);
  const isBest = lowest != null && Number.isFinite(lowest) && price <= lowest;

  return {
    name: `${LABEL} ${isBest ? 'Best Price' : 'On Sale'}`,
    value: `${dealText(game, price)}${stalenessMarker(game, now)}`,
  };
}
