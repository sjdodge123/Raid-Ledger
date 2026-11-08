import { and, asc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { MAX_ROSTER_CLAIM_CANDIDATES } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { escapeLikePattern } from '../../../../common/search.util';
import { inLatestSnapshot } from '../guild-membership.helpers';

/**
 * ROK-2128 — the roster-claim reads. "Claimed" is DERIVED (D2), never a
 * column: `guild_members` keeps no claimed-character field. ROK-2129
 * (Battle.net auto-claim) must reuse `isRowUnclaimed` rather than re-derive.
 *
 * Every predicate here references `guilds` and `guild_members` columns, so
 * callers select from `guild_members` INNER JOIN `guilds` — a joined select
 * keeps drizzle's table qualifiers on the interpolated outer columns.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers } = schema;

/** One unclaimed roster row with its guild, as the list endpoint reads it. */
export interface CandidateRow {
  guildId: number;
  guildName: string;
  region: string;
  memberId: number;
  name: string;
  class: string | null;
  level: number | null;
  source: string;
}

/**
 * D2: the member row is in its guild's latest snapshot AND no character of
 * the guild's game claims it by (a) `addon_guid = guid` (same region, or the
 * character's region unknown — the `characterLink()` rule), (b)
 * `external_id = blizzard_character_id::text`, or (c) the Forever identity
 * (same region + lower(name)). Any owner counts, active or not: the unique
 * identity index would refuse the claim either way.
 */
export function isRowUnclaimed(): SQL | undefined {
  const linked = sql`not exists (select 1 from "characters" c where c.game_id = ${guilds.gameId} and (
    (c.addon_guid = ${guildMembers.guid} and (c.region is null or lower(c.region) = lower(${guilds.region})))
    or (c.external_id = ${guildMembers.blizzardCharacterId}::text)
    or (lower(c.name) = lower(${guildMembers.characterName}) and lower(c.region) = lower(${guilds.region}))
  ))`;
  return and(inLatestSnapshot(), linked);
}

/**
 * FLAG 1 (ruled 2026-11-07): every approved, visible, non-archived WoW guild
 * hub of the game. `status` is always `active` for `wow_guild`
 * (`guilds_status_kind_check`); it is repeated so the rule reads whole.
 */
export function isClaimableGuild(gameId: number): SQL | undefined {
  return and(
    eq(guilds.gameId, gameId),
    eq(guilds.kind, 'wow_guild'),
    eq(guilds.status, 'active'),
    isNull(guilds.hiddenAt),
    isNull(guilds.archivedAt),
  );
}

/**
 * The unclaimed candidates of every claimable guild of the game, sorted by
 * guild name then character name. Reads one row past the cap so the caller
 * can tell a truncated list from an exact fit.
 */
export async function loadCandidates(
  db: Db,
  gameId: number,
  q?: string,
): Promise<CandidateRow[]> {
  const byName = q
    ? ilike(guildMembers.characterName, `%${escapeLikePattern(q)}%`)
    : undefined;
  return db
    .select({
      guildId: guilds.id,
      guildName: guilds.name,
      region: guilds.region,
      memberId: guildMembers.id,
      name: guildMembers.characterName,
      class: guildMembers.class,
      level: guildMembers.level,
      source: guildMembers.source,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(and(isClaimableGuild(gameId), isRowUnclaimed(), byName))
    .orderBy(asc(guilds.name), asc(guilds.id), asc(guildMembers.characterName))
    .limit(MAX_ROSTER_CLAIM_CANDIDATES + 1);
}
