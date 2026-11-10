import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  not,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as schema from '../../../drizzle/schema';

/**
 * ROK-1785 D3 / ROK-2115 — THE character ⇄ guild-member link. Never
 * re-derive it: every roster → user read joins `characters` to
 * `guild_members` ⋈ `guilds` through {@link characterLink}.
 *
 * Arm A ({@link guidLink}): the character's `addon_guid` equals the row's
 * LedgerLink GUID (same game; same region or the character's is unknown).
 * Arm B ({@link blizzardIdLink}): the character's `external_id` (Armory
 * import) equals the row's `blizzard_character_id` (same game, strictly the
 * guild's region — Blizzard ids are per region). GUID wins: arm B is off for
 * a row some ACTIVE owner's character GUID-holds, and for a character that
 * GUID-links to another live row of the same guild (no double rows). No name
 * fallback. ROK-2160: a deactivated owner's character never holds a row by
 * GUID — arm A skips it and it does not block arm B, so the row links to the
 * active Blizzard-id holder (one character per row).
 */

const { guilds, guildMembers, characters, users } = schema;

/** The row's GUID holder (Ruling 3) — aliased so it never clashes with the outer join. */
const guidHolder = alias(characters, 'link_guid_holder');
/** Another row of the same guild the character GUID-links to (Ruling 3). */
const otherRow = alias(guildMembers, 'link_other_row');

/** SQL predicate: the member row is in its guild's latest snapshot. */
export function inLatestSnapshot(): SQL | undefined {
  return or(
    isNull(guilds.lastSnapshotAt),
    gte(guildMembers.lastSeenAt, guilds.lastSnapshotAt),
  );
}

/**
 * Same region, or the character's region is unknown. GUIDs are only unique
 * per region (`characters` unique index is game + region + addon_guid), so a
 * same-GUID character in another region is a different player. `guilds.region`
 * is NOT NULL; a NULL character region falls back to GUID + game.
 */
export function sameRegionOrUnknown(): SQL | undefined {
  return or(
    isNull(characters.region),
    sql`lower(${characters.region}) = lower(${guilds.region})`,
  );
}

/**
 * ROK-2160: the owner (`users.id` = `ownerId`) is not deactivated. A
 * correlated sub-select, so it never clashes with an outer `users` join.
 */
export function ownerActive(ownerId: AnyColumn): SQL {
  return sql`exists (select 1 from ${users}
    where ${users.id} = ${ownerId} and ${users.deactivatedAt} is null)`;
}

/**
 * Arm A: the member's GUID on an ACTIVE owner's character of the guild's
 * game and region (ROK-2160).
 */
export function guidLink(): SQL {
  return (
    and(
      isNotNull(guildMembers.guid),
      eq(characters.addonGuid, guildMembers.guid),
      eq(characters.gameId, guilds.gameId),
      sameRegionOrUnknown(),
      ownerActive(characters.userId),
    ) ?? sql`false`
  );
}

/**
 * An ACTIVE owner's character of the guild's game (rules as arm A) holds the
 * row's GUID. ROK-2160: a deactivated holder does not block arm B.
 */
function rowHasGuidHolder(): SQL {
  return sql`exists (select 1 from ${characters} as ${guidHolder}
    where ${guidHolder.addonGuid} = ${guildMembers.guid}
      and ${guidHolder.gameId} = ${guilds.gameId}
      and (${guidHolder.region} is null
        or lower(${guidHolder.region}) = lower(${guilds.region}))
      and ${ownerActive(guidHolder.userId)})`;
}

/** The character GUID-links to ANOTHER live row of the same guild. */
function characterGuidOnOtherLiveRow(): SQL {
  return sql`(${characters.addonGuid} is not null and exists (
    select 1 from ${guildMembers} as ${otherRow}
    where ${otherRow.guildId} = ${guildMembers.guildId}
      and ${otherRow.id} <> ${guildMembers.id}
      and ${otherRow.guid} = ${characters.addonGuid}
      and (${guilds.lastSnapshotAt} is null
        or ${otherRow.lastSeenAt} >= ${guilds.lastSnapshotAt})))`;
}

/**
 * Arm B: the member's Blizzard character id on an Armory-imported character
 * of the guild's game, strictly in the guild's region, unless the GUID arm
 * owns the row or the character. ROK-2133 / ROK-2129 reuse this — never
 * re-derive the Blizzard-id join.
 */
export function blizzardIdLink(): SQL {
  return (
    and(
      // Keep: it lets Postgres prove the partial-index predicate of
      // idx_guild_members_guild_blizzard_id (0288) — the cast join alone cannot.
      isNotNull(guildMembers.blizzardCharacterId),
      sql`${characters.externalId} = ${guildMembers.blizzardCharacterId}::text`,
      eq(characters.gameId, guilds.gameId),
      sql`lower(${characters.region}) = lower(${guilds.region})`,
      not(rowHasGuidHolder()),
      not(
        and(sameRegionOrUnknown(), characterGuidOnOtherLiveRow()) ?? sql`false`,
      ),
    ) ?? sql`false`
  );
}

/** Join: the character links to the member row by GUID, else by Blizzard id. */
export function characterLink(): SQL {
  return or(guidLink(), blizzardIdLink()) ?? sql`false`;
}

/** Which arm linked a selected row — `'guid'` wins whenever both could. */
export function linkVia(): SQL<LinkVia> {
  return sql<LinkVia>`case when ${guidLink()} then 'guid' else 'blizzard' end`;
}

/** How a character links to a member row (ROK-2115). */
export type LinkVia = 'guid' | 'blizzard';
