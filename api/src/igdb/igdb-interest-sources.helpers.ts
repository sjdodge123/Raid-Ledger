import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

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
 * SQL condition on a `game_interests` row: the user has NOT un-hearted the
 * game. Un-heart keeps Steam library/wishlist rows (ownership + playtime are
 * facts other features read) and records a suppression instead, so every
 * "is this user interested" read must honour it (ROK-1796).
 */
export const NOT_SUPPRESSED = sql`not exists (
  select 1 from ${schema.gameInterestSuppressions} s
  where s.user_id = ${schema.gameInterests.userId}
    and s.game_id = ${schema.gameInterests.gameId}
)`;
