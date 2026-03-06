/**
 * Game library helpers for admin settings controller.
 * Extracted from settings.controller.ts for file size compliance.
 */
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { buildWordMatchFilters } from '../common/search.util';
import type { AdminGameListResponseDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

interface ListGamesParams {
  search?: string;
  showHidden?: string;
  page: number;
  limit: number;
}

/** Build game list query with search, visibility filters, and pagination. */
export async function queryGameList(
  db: PostgresJsDatabase<typeof schema>,
  params: ListGamesParams,
): Promise<AdminGameListResponseDto> {
  const safePage = Math.max(1, params.page);
  const safeLimit = Math.min(100, Math.max(1, params.limit));
  const offset = (safePage - 1) * safeLimit;

  const whereClause = buildGameWhereClause(params);

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.games)
      .where(whereClause),
    db
      .select({
        id: schema.games.id,
        igdbId: schema.games.igdbId,
        name: schema.games.name,
        slug: schema.games.slug,
        coverUrl: schema.games.coverUrl,
        cachedAt: schema.games.cachedAt,
        hidden: schema.games.hidden,
        banned: schema.games.banned,
      })
      .from(schema.games)
      .where(whereClause)
      .orderBy(schema.games.name)
      .limit(safeLimit)
      .offset(offset),
  ]);

  const total = countResult[0]?.count ?? 0;

  return {
    data: rows.map((r) => ({
      ...r,
      cachedAt: r.cachedAt.toISOString(),
    })),
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
      hasMore: safePage * safeLimit < total,
    },
  };
}

/** Build the WHERE clause for game list filtering. */
function buildGameWhereClause(params: ListGamesParams) {
  const conditions = [];
  if (params.search) {
    conditions.push(...buildWordMatchFilters(schema.games.name, params.search));
  }

  if (params.showHidden === 'only') {
    conditions.push(
      sql`(${schema.games.hidden} = true OR ${schema.games.banned} = true)`,
    );
  } else if (params.showHidden !== 'true') {
    conditions.push(eq(schema.games.hidden, false));
    conditions.push(eq(schema.games.banned, false));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}
