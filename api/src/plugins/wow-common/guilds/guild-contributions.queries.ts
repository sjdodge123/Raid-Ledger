/**
 * ROK-2148 D.3 — reads for the Guild contributions card (no access logic):
 * the stored Mailworthy template / givers / recent peers, and the guild's
 * latest-snapshot roster with each member's linked character + owner.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type {
  RosterRow,
  StoredPeer,
  StoredTemplate,
} from './guild-contributions.helpers';
import type { StoredGiver } from './guild-contributions.givers';
import { characterLink, inLatestSnapshot } from './guild-membership.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const {
  characters,
  guildMailworthyGivers: givers,
  guildMailworthyPeers: peers,
  guildMailworthyTemplates: templates,
  guildMembers,
  guilds,
} = schema;

export async function findTemplate(
  db: Db,
  guildId: number,
): Promise<StoredTemplate | null> {
  const [row] = await db
    .select({
      rev: templates.rev,
      authorName: templates.authorName,
      rules: templates.rules,
    })
    .from(templates)
    .where(eq(templates.guildId, guildId));
  return row ?? null;
}

export function findGivers(db: Db, guildId: number): Promise<StoredGiver[]> {
  return db
    .select({
      nameKey: givers.nameKey,
      characterName: givers.characterName,
      itemsAllTime: givers.itemsAllTime,
      countingSince: givers.countingSince,
      days: givers.days,
      asOf: givers.asOf,
    })
    .from(givers)
    .where(eq(givers.guildId, guildId));
}

/** Peers seen at or after `since` (the helper re-applies the window). */
export function findPeers(
  db: Db,
  guildId: number,
  since: Date,
): Promise<StoredPeer[]> {
  return db
    .select({ name: peers.name, lastSeenAt: peers.lastSeenAt })
    .from(peers)
    .where(and(eq(peers.guildId, guildId), gte(peers.lastSeenAt, since)));
}

/** Latest-snapshot members; `characterId`/`userId` null when unlinked. */
export function findRoster(db: Db, guildId: number): Promise<RosterRow[]> {
  return db
    .select({
      name: guildMembers.characterName,
      characterId: characters.id,
      userId: characters.userId,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(characters, characterLink() ?? sql`false`)
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot()));
}
