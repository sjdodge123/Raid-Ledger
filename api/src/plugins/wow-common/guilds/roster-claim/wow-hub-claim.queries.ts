/**
 * ROK-2153 S5 — the WoW claim provider's one read: is this hub a guild the
 * roster claim serves? The same rule as the join gate
 * (`JoinGateService.gate`): a WoW: Forever game AND `isClaimableGuild`
 * (active, unhidden, unarchived `wow_guild`). Never a second rule.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { findHubGuild } from '../../../../guilds/guild-core.queries';
import { isForeverGame } from '../../wow-forever-identity.helpers';
import { isClaimableGuild } from './roster-claim.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** The guild's game id when its roster can be claimed, else null. */
export async function findClaimableGuildGameId(
  db: Db,
  guildId: number,
): Promise<number | null> {
  const hub = await findHubGuild(db, guildId);
  if (hub === null || hub.gameSlug === null) return null;
  if (!isForeverGame({ slug: hub.gameSlug })) return null;
  const gameId = hub.guild.gameId;
  const [hit] = await db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(isClaimableGuild(gameId, guildId))
    .limit(1);
  return hit === undefined ? null : gameId;
}
