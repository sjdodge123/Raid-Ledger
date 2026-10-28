import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import { characterLink } from '../guild-membership.helpers';
import { ownerIsActive } from '../guild-roster.helpers';
import type { RawDingRow } from './recent-dings.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, guildMemberLevelEvents: ev } = schema;

/**
 * The guild's level-up events since `since`, newest first, each LEFT-joined
 * to the active RL character carrying the member's GUID (same link as the
 * roster). A GUID can match two characters (one with an unknown region), so
 * the caller dedupes by event id — hence `rowCap` > the feed size.
 */
export async function loadDingRows(
  db: Db,
  guildId: number,
  since: Date,
  rowCap: number,
): Promise<RawDingRow[]> {
  return db
    .select({
      id: ev.id,
      name: guildMembers.characterName,
      characterId: characters.id,
      fromLevel: ev.fromLevel,
      toLevel: ev.toLevel,
      occurredAt: ev.occurredAt,
    })
    .from(ev)
    .innerJoin(guildMembers, eq(guildMembers.id, ev.guildMemberId))
    .innerJoin(guilds, eq(guilds.id, ev.guildId))
    .leftJoin(
      characters,
      and(isNotNull(guildMembers.guid), characterLink(), ownerIsActive()),
    )
    .where(and(eq(ev.guildId, guildId), gte(ev.occurredAt, since)))
    .orderBy(desc(ev.occurredAt), desc(ev.id))
    .limit(rowCap);
}
