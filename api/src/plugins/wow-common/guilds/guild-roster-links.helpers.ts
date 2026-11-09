import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildMemberLinkVia } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import {
  CHARACTER_CLAIM_ENTITY,
  ROSTER_CLAIMED_ACTION,
} from '../../../characters/characters-roster-claim.helpers';
import { GUID_AUDIT_ENTITY } from '../addon-import/addon-import.guid-audit';
import { LINK_AUDIT_ACTIONS } from './guild-delegation.helpers';
import { guidLink } from './guild-link.predicates';
import type { RawRosterRow, RosterLinks } from './guild-roster.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const {
  characters: c,
  users,
  activityLog: al,
  guildMembers: gm,
  guilds: g,
} = schema;

/**
 * ROK-1794 (review): since when the character's link is the one a member
 * grant can confirm — its creation, its latest GUID claim (first pin, repin
 * or admin reassign) or (ROK-2115) its latest `external_id_linked`,
 * whichever is later. `hasConfirmedMemberGrant` honours a grant
 * exactly when it was made at or after this moment (character created ≤
 * grant, no claim after the grant): the same "confirmed link" time.
 */
export function linkConfirmedAt() {
  const lastClaim = sql`(select max(${al.createdAt}) from ${al} where ${and(
    eq(al.entityType, GUID_AUDIT_ENTITY),
    inArray(al.action, [...LINK_AUDIT_ACTIONS]),
    sql`${al.metadata}->>'characterId' = ${c.id}::text`,
  )})`;
  return sql<Date>`greatest(${c.createdAt}, ${lastClaim})`.mapWith(c.createdAt);
}

/**
 * ROK-2128 (FLAG 3): true when the CURRENT owner claimed the character from a
 * guild roster pick (a `roster_claimed` audit names it, filed under the
 * owner) — a self-asserted link. After an admin Change owner the new owner
 * picked nothing, so it reads as an import (review 2 MINOR). Evaluated per
 * row inside the page's single select, so the roster stays one query.
 */
export function rosterPicked() {
  return sql<boolean>`exists(select 1 from ${al} where ${and(
    eq(al.entityType, CHARACTER_CLAIM_ENTITY),
    eq(al.action, ROSTER_CLAIMED_ACTION),
    eq(al.entityId, c.userId),
    sql`${al.metadata}->>'characterId' = ${c.id}::text`,
  )})`;
}

/**
 * ROK-2115 (Ruling 6): true when the character holds the LedgerLink GUID of
 * any of `memberIds` (the shared GUID arm, correlated to the outer
 * `characters` row). False means the roster links it only by Blizzard id.
 */
export function guidLinkedToAny(memberIds: number[]): SQL<boolean> {
  if (memberIds.length === 0) return sql<boolean>`false`;
  return sql<boolean>`exists (select 1 from ${gm} inner join ${g} on ${eq(
    g.id,
    gm.guildId,
  )} where ${and(inArray(gm.id, memberIds), guidLink())})`;
}

/**
 * ROK-2115 (Ruling 6): the staff "linked via" label. A roster pick wins
 * (ROK-2128); otherwise a GUID link is an `import` and a link made only by
 * an Armory import's Blizzard id is `armory` — self-asserted, no GUID proof.
 */
export function rosterLinkVia(link: {
  picked: boolean;
  guidLinked: boolean;
}): GuildMemberLinkVia {
  if (link.picked) return 'roster_pick';
  return link.guidLinked ? 'import' : 'armory';
}

/** The distinct linked character ids and the roster rows they link. */
function linkedIds(rows: RawRosterRow[]): {
  ids: string[];
  memberIds: number[];
} {
  const linked = rows.flatMap((r) =>
    r.characterId ? [{ memberId: r.memberId, charId: r.characterId }] : [],
  );
  return {
    ids: [...new Set(linked.map((r) => r.charId))],
    memberIds: [...new Set(linked.map((r) => r.memberId))],
  };
}

/**
 * STAFF-ONLY (the caller gates it): the RL account behind each linked roster
 * row, since when, and how it was linked (`linkVia`, ROK-2128), keyed by
 * linked character id.
 */
export async function loadRosterLinks(
  db: Db,
  rows: RawRosterRow[],
): Promise<RosterLinks> {
  const { ids, memberIds } = linkedIds(rows);
  if (ids.length === 0) return new Map();
  const found = await db
    .select({
      id: c.id,
      username: users.username,
      since: linkConfirmedAt(),
      picked: rosterPicked(),
      guidLinked: guidLinkedToAny(memberIds),
    })
    .from(c)
    .innerJoin(users, eq(users.id, c.userId))
    .where(inArray(c.id, ids));
  return new Map(
    found.map((r) => [
      r.id,
      {
        username: r.username,
        linkedSince: new Date(r.since).toISOString(),
        linkVia: rosterLinkVia(r),
      },
    ]),
  );
}
