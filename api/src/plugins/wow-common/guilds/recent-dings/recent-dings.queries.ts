import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../drizzle/schema';
import {
  characterLink,
  inLatestSnapshot,
} from '../guild-membership.helpers';
import { ownerIsActive } from '../guild-roster.helpers';
import type { RawDingRow } from './recent-dings.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, guildMemberLevelEvents: ev } = schema;

/** Newest event first; within one event, region-matched then lowest-id character. */
function dingOrder() {
  return [
    desc(ev.occurredAt),
    desc(ev.id),
    sql`${characters.region} IS NULL`,
    asc(characters.id),
  ];
}

/**
 * The guild's level-up events since `since`, newest first, each LEFT-joined
 * to the active RL character carrying the member's GUID (same link as the
 * roster). A GUID can match two characters (one with an unknown region), so
 * the caller dedupes by event id (first row wins) — hence `rowCap` > the
 * feed size. Within one event the region-matched character sorts first, then
 * the lowest id, so `characterId` is stable across reads. Only members in
 * the guild's latest snapshot count (ROK-2035): a departed member's dings
 * stay in the log but leave the feed.
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
    .where(
      and(
        eq(ev.guildId, guildId),
        gte(ev.occurredAt, since),
        inLatestSnapshot(),
      ),
    )
    .orderBy(...dingOrder())
    .limit(rowCap);
}
