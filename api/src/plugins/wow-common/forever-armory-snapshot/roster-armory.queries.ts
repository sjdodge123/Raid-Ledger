/**
 * ROK-2133 D3 step 2: the roster Armory pass's due-member query. The SQL due
 * predicate mirrors `isMemberDue` (snapshot.helpers.ts) — keep them in step.
 */
import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { inLatestSnapshot } from '../guilds/guild-membership.helpers';
import { isClaimableGuild } from '../guilds/roster-claim/roster-claim.queries';
import { memberOwnedByCharacterSync } from './snapshot.apply';
import { MIN_LEVEL, RESYNC_AFTER_MS } from './snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One due roster member: who to fetch and where to write it. */
export interface DueRosterMember {
  memberId: number;
  guildId: number;
  blizzardCharacterId: number;
  characterName: string;
  region: string;
  /** `guild_members.level` now (≥ 10 by the due filter). */
  rosterLevel: number;
}

/** Due-query scope: the Forever game, the cap, optionally one guild. */
export interface DueRosterQuery {
  gameId: number;
  now: Date;
  limit: number;
  guildId?: number | undefined;
}

const gm = schema.guildMembers;
const arm = schema.guildMemberArmory;

/**
 * Not synced, synced more than 24 h ago, or the roster level moved since the
 * last sync (vs the stored `roster_level`, never Blizzard's `level`) — and
 * not backing off. A member with no snapshot row is due.
 */
function isDue(now: Date): SQL | undefined {
  const staleBefore = new Date(now.getTime() - RESYNC_AFTER_MS);
  const stale = or(
    isNull(arm.syncedAt),
    lt(arm.syncedAt, staleBefore),
    sql`${arm.rosterLevel} IS DISTINCT FROM ${gm.level}`,
  );
  // Typed comparators, never a raw Date inside sql`` — postgres.js cannot
  // bind a Date there ("The string argument must be of type string…").
  const notBackingOff = or(isNull(arm.retryAt), lte(arm.retryAt, now));
  return and(stale, notBackingOff);
}

/**
 * The whole due-member filter for one query scope. Only the current roster
 * (`inLatestSnapshot`, as the members list) — a soft-removed member is
 * never fetched.
 */
function dueWhere(q: DueRosterQuery): SQL | undefined {
  return and(
    isClaimableGuild(q.gameId),
    q.guildId === undefined ? undefined : eq(gm.guildId, q.guildId),
    inLatestSnapshot(),
    isNotNull(gm.blizzardCharacterId),
    gte(gm.level, MIN_LEVEL),
    not(memberOwnedByCharacterSync()),
    isDue(q.now),
  );
}

/**
 * Up to `limit` due members of claimable Forever hubs, oldest snapshot
 * first (never-synced first): a Blizzard id, level ≥ 10, in the latest
 * snapshot, and no roster-linked Armory character already refreshing that id.
 */
export async function listDueRosterMembers(
  db: Db,
  q: DueRosterQuery,
): Promise<DueRosterMember[]> {
  const rows = await db
    .select({
      memberId: gm.id,
      guildId: gm.guildId,
      blizzardCharacterId: gm.blizzardCharacterId,
      characterName: gm.characterName,
      region: schema.guilds.region,
      rosterLevel: gm.level,
    })
    .from(gm)
    .innerJoin(schema.guilds, eq(schema.guilds.id, gm.guildId))
    .leftJoin(arm, eq(arm.guildMemberId, gm.id))
    .where(dueWhere(q))
    .orderBy(sql`${arm.syncedAt} ASC NULLS FIRST`, asc(gm.id))
    .limit(q.limit);
  return rows.flatMap(({ blizzardCharacterId, rosterLevel, ...r }) =>
    blizzardCharacterId === null || rosterLevel === null
      ? []
      : [{ ...r, blizzardCharacterId, rosterLevel }],
  );
}
