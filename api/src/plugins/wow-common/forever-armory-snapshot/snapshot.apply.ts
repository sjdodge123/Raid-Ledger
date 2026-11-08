/**
 * ROK-2133: the writes behind a roster member's Armory snapshot (D2) — the
 * member row upsert, its failure bookkeeping, the compare-and-set copy onto
 * an unlinked `characters` row, and the SQL predicate that keeps the roster
 * pass off members whose Blizzard id a linked character already syncs.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import { WOW_FOREVER_VARIANT } from '../forever-armory-switch';
import {
  nextRetryAt,
  snapshotToCharacterColumns,
  type MemberArmoryErrorKind,
  type MemberArmorySnapshot,
} from './snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Which member a verified snapshot is written to, and its roster state. */
export interface MemberSnapshotTarget {
  memberId: number;
  /** The roster's Blizzard id the fetched profile was verified against. */
  blizzardId: number;
  /** The roster level now — stored as `roster_level` for the due rule. */
  rosterLevel: number;
}

/**
 * Store a snapshot whose fetched id was verified against the roster's
 * `blizzardId`, record the roster level seen at this sync, and reset the
 * member's failures / backoff.
 */
export async function writeMemberSnapshot(
  db: Db,
  target: MemberSnapshotTarget,
  snapshot: MemberArmorySnapshot,
  now: Date,
): Promise<void> {
  const t = schema.guildMemberArmory;
  const { memberId, blizzardId, rosterLevel } = target;
  const set = {
    ...snapshot,
    blizzardCharacterId: blizzardId,
    rosterLevel,
    syncedAt: snapshot.syncedAt ?? now,
    lastAttemptAt: now,
    failures: 0,
    retryAt: null,
    lastError: null,
  };
  await db
    .insert(t)
    .values({ guildMemberId: memberId, ...set })
    .onConflictDoUpdate({ target: t.guildMemberId, set });
}

/**
 * Count one failed attempt of `kind`: `failures + 1`, `retry_at` from the
 * new count (`nextRetryAt`), `last_error`. Any stored snapshot data is kept.
 */
export async function recordMemberFailure(
  db: Db,
  memberId: number,
  kind: MemberArmoryErrorKind,
  now: Date,
): Promise<void> {
  const t = schema.guildMemberArmory;
  await db.transaction(async (tx) => {
    const failures = await bumpFailureCount(tx, memberId, kind, now);
    await tx
      .update(t)
      .set({ retryAt: nextRetryAt(kind, failures, now) })
      .where(eq(t.guildMemberId, memberId));
  });
}

/** Upsert the failure columns (`failures + 1`); returns the new count. */
async function bumpFailureCount(
  tx: Pick<Db, 'insert'>,
  memberId: number,
  kind: MemberArmoryErrorKind,
  now: Date,
): Promise<number> {
  const t = schema.guildMemberArmory;
  const [row] = await tx
    .insert(t)
    .values({
      guildMemberId: memberId,
      failures: 1,
      retryAt: nextRetryAt(kind, 1, now),
      lastError: kind,
      lastAttemptAt: now,
    })
    .onConflictDoUpdate({
      target: t.guildMemberId,
      set: {
        failures: sql`guild_member_armory.failures + 1`,
        lastError: kind,
        lastAttemptAt: now,
      },
    })
    .returning({ failures: t.failures });
  return row?.failures ?? 1;
}

/**
 * Copy a verified snapshot onto a character that is not Armory-linked yet
 * (compare-and-set on `game_variant IS NULL`), marking it linked. Never
 * writes name, realm, region, ruleset, addon_guid or userId.
 * @returns false when the snapshot was never synced or the row is gone /
 *   already linked (a live sync's data always wins over a copy).
 */
export async function applySnapshotToCharacter(
  db: Db,
  characterId: string,
  snapshot: MemberArmorySnapshot,
): Promise<boolean> {
  const columns = snapshotToCharacterColumns(snapshot);
  if (columns === null) return false;
  const c = schema.characters;
  const updated = await db
    .update(c)
    .set({ ...columns, updatedAt: new Date() })
    .where(and(eq(c.id, characterId), isNull(c.gameVariant)))
    .returning({ id: c.id });
  return updated.length > 0;
}

/**
 * True for a `guild_members` row whose Blizzard id an Armory-linked Forever
 * character already holds — the twice-daily character sync refreshes that
 * id, so the roster pass skips the member (D2, L3). Use inside a query
 * that selects from `guild_members`.
 */
export function memberOwnedByCharacterSync(): SQL {
  const memberId = schema.guildMembers.blizzardCharacterId;
  return sql`exists (
    select 1 from characters oc
    where oc.game_variant = ${WOW_FOREVER_VARIANT}
      and oc.external_id = ${memberId}::text
  )`;
}
