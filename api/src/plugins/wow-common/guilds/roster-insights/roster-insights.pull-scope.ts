import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { inLatestSnapshot } from '../guild-membership.helpers';

type Db = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/**
 * ROK-1917 — a raid pull's scope: (game, region, realm-less guild key). The
 * pull's dedupe key carries no realm, so every `wow_guild` hub sharing the
 * name key is a candidate guild for the pull.
 */
export interface PullScope {
  gameId: number;
  region: string;
  guildKey: string;
}

/** Ids of every `wow_guild` hub in the pull scope (trust + cache invalidation). */
export async function pullScopeHubIds(
  db: Db,
  scope: PullScope,
): Promise<number[]> {
  const { guilds } = schema;
  const rows = await db
    .select({ id: guilds.id })
    .from(guilds)
    .where(
      and(
        eq(guilds.gameId, scope.gameId),
        eq(guilds.region, scope.region),
        eq(guilds.nameKey, scope.guildKey),
        eq(guilds.kind, 'wow_guild'),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * ROK-1917 final P2 — true when `guid` (a GUID this import is about to pin on
 * the importer's character) sits on the current roster of one of `hubIds`,
 * i.e. the importer is a linked member once the binding lands in this tx.
 */
export async function guidOnScopeRoster(
  db: Db,
  hubIds: readonly number[],
  guid: string,
): Promise<boolean> {
  if (hubIds.length === 0) return false;
  const { guildMembers, guilds } = schema;
  const rows = await db
    .select({ id: guildMembers.guildId })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(
      and(
        inArray(guildMembers.guildId, [...hubIds]),
        eq(guildMembers.guid, guid),
        inLatestSnapshot(),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
