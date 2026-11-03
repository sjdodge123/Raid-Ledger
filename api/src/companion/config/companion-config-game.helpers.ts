/**
 * ROK-2067 D13 — which game a `/config` contract shows art for. The owner
 * plugin's game slugs are joined to `games` rows (one query, with each row's
 * hub count); the pick is pure so the rule is unit-testable.
 */
import type { CompanionConfigGame } from '@raid-ledger/contract';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/** One candidate `games` row with its non-archived hub count. */
export interface ConfigGameRow {
  slug: string;
  name: string;
  coverUrl: string | null;
  hubs: number;
}

/**
 * `games` rows for `slugs` (cover = IGDB, else ITAD boxart; an empty string
 * counts as no cover — `coverUrl` is `min(1)`) + hub counts.
 */
export async function loadConfigGameRows(
  db: PostgresJsDatabase<typeof schema>,
  slugs: readonly string[],
): Promise<ConfigGameRow[]> {
  if (slugs.length === 0) return [];
  const { games, guilds } = schema;
  return db
    .select({
      slug: games.slug,
      name: games.name,
      coverUrl: sql<
        string | null
      >`coalesce(nullif(${games.coverUrl}, ''), nullif(${games.itadBoxartUrl}, ''))`,
      hubs: sql<number>`count(${guilds.id})::int`,
    })
    .from(games)
    .leftJoin(
      guilds,
      and(eq(guilds.gameId, games.id), ne(guilds.status, 'archived')),
    )
    .where(inArray(games.slug, [...slugs]))
    .groupBy(games.id);
}

/** Rows in manifest `slugs` order (unknown slugs dropped). */
function inSlugOrder(
  slugs: readonly string[],
  rows: readonly ConfigGameRow[],
): ConfigGameRow[] {
  return slugs.flatMap((slug) => rows.filter((r) => r.slug === slug));
}

/**
 * One slug with strictly the most hubs wins. A tie or no hubs goes to
 * `primary` among ALL rows (CONTRACT §4.2), else the first tied leader in
 * manifest order. A picked row with no cover borrows the first sibling cover.
 */
export function pickConfigGame(
  slugs: readonly string[],
  primary: string | undefined,
  rows: readonly ConfigGameRow[],
): CompanionConfigGame | null {
  const ordered = inSlugOrder(slugs, rows);
  const most = Math.max(0, ...ordered.map((r) => r.hubs));
  const leaders = ordered.filter((r) => r.hubs === most);
  const clearWinner = most > 0 && leaders.length === 1 ? leaders[0] : undefined;
  const picked =
    clearWinner ?? ordered.find((r) => r.slug === primary) ?? leaders[0];
  if (!picked) return null;
  const coverUrl =
    picked.coverUrl ?? ordered.find((r) => r.coverUrl !== null)?.coverUrl;
  return { slug: picked.slug, name: picked.name, coverUrl: coverUrl ?? null };
}
