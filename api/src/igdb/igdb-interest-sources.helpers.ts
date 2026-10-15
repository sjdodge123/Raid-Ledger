/**
 * Per-user interest source rules (ROK-1796).
 *
 * Public interest counts and the "interested players" list stay on
 * `HEART_SOURCES` — Steam library/wishlist users already appear in their own
 * "owned by" / "wishlisted by" sections, so folding them into the heart count
 * would double-count them. The per-user `wantToPlay` flag is different: a user
 * whose only tie to a game is a Steam row still receives interest-driven DMs,
 * so their heart must be visible (and removable) to them.
 */

/** Sources that light the CURRENT user's heart (hearts + Steam sync rows). */
export const USER_HEART_SOURCES = [
  'manual',
  'discord',
  'steam',
  'poll',
  'steam_library',
  'steam_wishlist',
];

/** Rows written by the Steam library/wishlist syncs. */
export const STEAM_SYNC_SOURCES = ['steam_library', 'steam_wishlist'];

/** The `source` values the interest response DTO accepts. */
export type InterestDtoSource = 'manual' | 'steam' | 'discord' | 'poll';

const DTO_SOURCES: readonly string[] = ['manual', 'steam', 'discord', 'poll'];

function isDtoSource(source: string): source is InterestDtoSource {
  return DTO_SOURCES.includes(source);
}

/**
 * Map a stored `game_interests.source` to the response DTO's source.
 * Steam sync rows report as `steam`; unknown values report nothing.
 */
export function toDtoSource(
  source: string | null,
): InterestDtoSource | undefined {
  if (source === null) return undefined;
  if (STEAM_SYNC_SOURCES.includes(source)) return 'steam';
  return isDtoSource(source) ? source : undefined;
}

/**
 * Whether an un-heart must write a suppression row: any source other than a
 * manual heart is re-created automatically (Discord activity, poll votes,
 * the daily Steam syncs), so it must be told to stay away.
 */
export function needsSuppression(sources: readonly string[]): boolean {
  return sources.some((s) => s !== 'manual');
}
