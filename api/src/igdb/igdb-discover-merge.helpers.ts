import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { GameDiscoverRowDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { loadApprovedDynamicRows } from '../discovery-categories/discovery-categories.discover.helpers';
import { dispatchDiscoverRow } from './igdb-discover-dispatch.helpers';
import type { DiscoverCategory } from './igdb-discover.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Merge static IGDB-driven rows with the approved dynamic rows from ROK-567.
 * Keeps the controller handler slim by hiding the `Promise.all` + filter.
 */
export async function buildDiscoverRows(
  categories: DiscoverCategory[],
  db: Db,
  redis: Redis,
  cacheTtl: number,
): Promise<GameDiscoverRowDto[]> {
  const [staticRows, dynamicRows] = await Promise.all([
    Promise.all(
      categories.map((cat) => dispatchDiscoverRow(cat, db, redis, cacheTtl)),
    ),
    loadApprovedDynamicRows(db),
  ]);
  return [...staticRows, ...dynamicRows].filter((r) => r.games.length > 0);
}
