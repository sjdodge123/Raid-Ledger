import { and, eq, gt, inArray, lte, notExists, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { GUID_AUDIT_ENTITY } from '../addon-import/addon-import.guid-audit';
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

/**
 * A GUID claim (first pin or repin) by the linking character AFTER the grant
 * was made: the link is no longer the one staff confirmed.
 */
function claimedSinceGrant(db: Db) {
  return db
    .select({ one: sql`1` })
    .from(al)
    .where(
      and(
        eq(al.entityType, GUID_AUDIT_ENTITY),
        eq(al.action, 'addon_guid_claimed'),
        sql`${al.metadata}->>'characterId' = ${c.id}::text`,
        gt(al.createdAt, ge.createdAt),
      ),
    );
}

/** The user's own characters that link to the granted member row. */
function linkingCharacter(rows: LinkedMemberRow[]) {
  const ids = rows.map((r) => r.characterId);
  return and(eq(c.addonGuid, gm.guid), inArray(c.id, ids));
}

/**
 * A member-kind grant applies only to the link staff saw when granting: the
 * linking character existed at grant time and has claimed no GUID since. A
 * character created, or repinned onto the member's GUID, afterwards gets no
 * delegation (AC5) — staff re-grant to confirm the new link.
 */
export async function hasConfirmedMemberGrant(
  db: Db,
  guildId: number,
  rows: LinkedMemberRow[],
): Promise<boolean> {
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
