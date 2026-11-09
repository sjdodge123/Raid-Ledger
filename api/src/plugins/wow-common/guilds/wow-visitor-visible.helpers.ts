import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import { claimableGuildBase } from './roster-claim/roster-claim.queries';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-2132 Ruling 2: the WoW guild hubs the `/hubs` directory lists to a
 * non-member — every claimable WoW: Forever guild (active, not hidden, not
 * archived: the ROK-2128 pick-list audience). Retail / Classic guilds have no
 * roster-claim path, so they stay members-only.
 * Same rule as the pick list (`claimableGuildBase`), over every Forever game.
 */
export async function findClaimableForeverGuildIds(db: Db): Promise<number[]> {
  const g = schema.guilds;
  const rows = await db
    .select({ id: g.id })
    .from(g)
    .innerJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(
      and(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG), claimableGuildBase()),
    );
  return rows.map((r) => r.id);
}
