import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildSummary } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type { HubMediaSourceGateRegistry } from '../../hub-media/hub-media.source-gates';
import { findVisibleCrestMediaId } from './hub-crest.queries';

type Db = PostgresJsDatabase<typeof schema>;
type Gates = Pick<HubMediaSourceGateRegistry, 'hiddenSources'>;

/**
 * ROK-2074 — `GuildSummary.crestMediaId` for the hub page: the gallery
 * picture a shown upload crest was picked from, while every viewer can
 * still open it in the Gallery viewer. A preset/initials crest skips the
 * read; no gate registry (fail closed) or any lookup miss → null.
 */
export async function crestMediaIdFor(
  db: Db,
  gates: Gates | null,
  guild: Pick<GuildSummary, 'id' | 'crest'>,
): Promise<number | null> {
  if (guild.crest?.source !== 'upload' || gates === null) return null;
  const excludeSources = await gates.hiddenSources(guild.id);
  return findVisibleCrestMediaId(db, guild.id, excludeSources);
}
