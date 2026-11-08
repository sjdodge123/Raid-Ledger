import { and, eq, gt, inArray, lte, notExists, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { GUID_AUDIT_ENTITY } from '../addon-import/addon-import.guid-audit';
import { EXTERNAL_ID_LINKED_ACTION } from '../addon-import/external-id.audit';
import type { LinkedMemberRow } from './guild-membership.helpers';

/**
 * SECURITY (ROK-1794, 2026-10-18 review): a rank-kind `guild_editors` grant
 * confers NOTHING while character ownership is unverified — `rank_index`
 * comes from unsigned LedgerLink exports, so anyone can list their own GUID
 * at a delegated rank. Same treatment as `GM_RANK_IMPLIES_EDIT = false`.
 * Flip once ownership is verified (the parked half of ROK-1794).
 */
export const RANK_GRANTS_CONFER_EDIT = false;

type Db = PostgresJsDatabase<typeof schema>;

const {
  guildEditors: ge,
  guildMembers: gm,
  characters: c,
  activityLog: al,
} = schema;

/** The audits that mark a fresh link: a GUID claim (first pin, repin or
 * admin reassign) or, ROK-2115 Ruling 5, a Blizzard-id link. */
export const LINK_AUDIT_ACTIONS = [
  'addon_guid_claimed',
  EXTERNAL_ID_LINKED_ACTION,
] as const;

/**
 * A fresh link (GUID claim or Blizzard-id link) by the linking character
 * AFTER the grant was made: the link is no longer the one staff confirmed.
 */
function claimedSinceGrant(db: Db) {
  return db
    .select({ one: sql`1` })
    .from(al)
    .where(
      and(
        eq(al.entityType, GUID_AUDIT_ENTITY),
        inArray(al.action, [...LINK_AUDIT_ACTIONS]),
        sql`${al.metadata}->>'characterId' = ${c.id}::text`,
        gt(al.createdAt, ge.createdAt),
      ),
    );
}

/**
 * The user's own character that links to the granted member row — the
 * (member, character) pairs `findLinkedMemberRows` already resolved through
 * THE link predicate (GUID or, ROK-2115, Blizzard id); never re-derived here.
 */
function linkingCharacter(rows: LinkedMemberRow[]) {
  return or(
    ...rows.map((r) => and(eq(gm.id, r.memberId), eq(c.id, r.characterId))),
  );
}

/**
 * A member-kind grant applies only to the link staff saw when granting: the
 * linking character existed at grant time and has made no fresh link since
 * (GUID claim or Blizzard-id link). A character created, repinned or
 * Blizzard-linked onto the member afterwards gets no delegation (AC5) —
 * staff re-grant to confirm the new link.
 */
export async function hasConfirmedMemberGrant(
  db: Db,
  guildId: number,
  rows: LinkedMemberRow[],
): Promise<boolean> {
  if (rows.length === 0) return false;
  const grants = await db
    .select({ id: ge.id })
    .from(ge)
    .innerJoin(gm, eq(gm.id, ge.guildMemberId))
    .innerJoin(c, linkingCharacter(rows))
    .where(
      and(
        eq(ge.guildId, guildId),
        eq(ge.kind, 'member'),
        inArray(
          ge.guildMemberId,
          rows.map((r) => r.memberId),
        ),
        lte(c.createdAt, ge.createdAt),
        notExists(claimedSinceGrant(db)),
      ),
    )
    .limit(1);
  return grants.length > 0;
}

async function hasRankGrant(
  db: Db,
  guildId: number,
  rows: LinkedMemberRow[],
): Promise<boolean> {
  const ranks = rows.flatMap((r) =>
    r.rankIndex === null ? [] : [r.rankIndex],
  );
  if (!RANK_GRANTS_CONFER_EDIT || ranks.length === 0) return false;
  const grants = await db
    .select({ id: ge.id })
    .from(ge)
    .where(and(eq(ge.guildId, guildId), inArray(ge.rankIndex, ranks)))
    .limit(1);
  return grants.length > 0;
}

/** Does any of the user's live member rows carry an effective editor grant? */
export async function hasDelegation(
  db: Db,
  guildId: number,
  rows: LinkedMemberRow[],
): Promise<boolean> {
  if (rows.length === 0) return false;
  if (await hasRankGrant(db, guildId, rows)) return true;
  return hasConfirmedMemberGrant(db, guildId, rows);
}
