import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
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

/** Sources a user sets by hearting. Library/wishlist rows are Steam sync. */
export const HEART_SOURCES = ['manual', 'discord', 'steam', 'poll'];

/** Column refs of the `game_interests` row the interest condition tests. */
interface InterestRowColumns {
  userId: SQLWrapper;
  gameId: SQLWrapper;
  source: SQLWrapper;
}

/**
 * SQL condition on a `game_interests` row: the row counts as INTEREST.
 *
 * Un-heart keeps Steam library/wishlist rows (ownership + playtime are facts
 * other features read) and records a suppression instead (ROK-1796). The
 * suppression masks ONLY Steam-sourced rows: a heart-source row always counts,
 * so a re-heart (or a concurrent Discord heart) wins over a stale suppression.
 * A (user, game) pair is therefore interested iff it has a heart-source row,
 * or a Steam row and no suppression. Every reader that treats
 * `game_interests` as interest/hearts/subscription must apply this.
 */
export function interestedRowCondition(cols: InterestRowColumns): SQL {
  const hearts = sql.join(
    HEART_SOURCES.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`(${cols.source} in (${hearts}) or not exists (
    select 1 from ${schema.gameInterestSuppressions} gis
    where gis.user_id = ${cols.userId}
      and gis.game_id = ${cols.gameId}
  ))`;
}

/** {@link interestedRowCondition} for query-builder reads of `game_interests`. */
export const INTERESTED_ROW = interestedRowCondition({
  userId: schema.gameInterests.userId,
  gameId: schema.gameInterests.gameId,
  source: schema.gameInterests.source,
});

/** {@link interestedRowCondition} for raw SQL aliasing `game_interests gi`. */
export const INTERESTED_GI_ROW = interestedRowCondition({
  userId: sql.raw('gi.user_id'),
  gameId: sql.raw('gi.game_id'),
  source: sql.raw('gi.source'),
});
