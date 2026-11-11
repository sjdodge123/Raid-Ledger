import { and, asc, eq, exists, gt, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { guidLink } from '../guilds/guild-link.predicates';
import type { AddonImportTx } from './addon-import-apply.types';
import { logGuidAudit } from './addon-import.guid-audit';
import {
  auditGuidReleases,
  heldGuidsOf,
  lockReleasedRows,
} from './external-id.guid-release';

/**
 * ROK-2160 (Codex P1) — a deactivated owner's character stops holding its
 * roster rows by GUID (`ownerActive`), and holds them again on reactivation.
 * Either flip changes which character wins a row, and a ROK-1794 member grant
 * must never move to another user without a staff action:
 *
 * - Deactivation: every OTHER user's Blizzard-id character that now wins a
 *   row the owner's GUIDs held gets a fresh `external_id_linked` (the
 *   ROK-2115 release audit). The owner's own characters are skipped: one
 *   holding both ids re-wins the row unchanged (ROK-2175).
 * - Reactivation: the owner's GUID character gets a fresh `addon_guid_claimed`
 *   (via `owner_reactivated`) only for rows with a member grant made while the
 *   owner was deactivated — that grant confirmed someone else. The owner's own
 *   earlier grant stays valid when nobody was granted meanwhile.
 *
 * Both run on the caller's tx, AFTER `deactivated_at` is written.
 */

const { users, guilds, guildMembers, guildEditors, characters } = schema;

/** Call after `deactivated_at` is set (same tx). */
export async function auditOwnerDeactivated(
  tx: AddonImportTx,
  userId: number,
  actorId: number | null,
): Promise<void> {
  const held = await heldGuidsOf(tx, userId);
  // Serialise with a staff grant on the same rows (review r3 N2).
  await lockReleasedRows(tx, held);
  // ROK-2175: the owner's own both-ids character re-winning R is no transfer.
  await auditGuidReleases(tx, held, actorId, sql`clock_timestamp()`, userId);
}

/**
 * The user's `deactivated_at`, row-locked, as Postgres text; undefined = no
 * such user. Text, not a JS Date: the column is a naive `timestamp` written by
 * `NOW()` in the session time zone, and is compared to timestamptz grants in
 * SQL with the same session cast (review r2 M2) — a JS round-trip reads it as
 * UTC and is wrong whenever the session time zone is not UTC.
 */
export async function lockDeactivatedAt(
  tx: AddonImportTx,
  userId: number,
): Promise<string | null | undefined> {
  const [row] = await tx
    .select({ at: sql<string | null>`${users.deactivatedAt}::text` })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  return row ? row.at : undefined;
}

/** A member grant on the row made after `since` (naive timestamp text). */
function grantedSince(tx: AddonImportTx, since: string) {
  return exists(
    tx
      .select({ one: sql`1` })
      .from(guildEditors)
      .where(
        and(
          eq(guildEditors.guildMemberId, guildMembers.id),
          eq(guildEditors.kind, 'member'),
          gt(guildEditors.createdAt, sql`${since}::timestamp`),
        ),
      ),
  );
}

/**
 * ROK-2160 (review r3 m1) — `FOR UPDATE` the roster rows the user's GUID
 * characters win, BEFORE `grantedSince` reads them: a staff grant still open
 * on a row (`insertMemberGrant` holds `FOR SHARE`) commits first and is then
 * seen. Lock order as `lockReleasedRows`: users row, then rows by id.
 */
async function lockWonRows(tx: AddonImportTx, userId: number): Promise<void> {
  await tx
    .select({ id: guildMembers.id })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, guidLink())
    .where(eq(characters.userId, userId))
    .orderBy(asc(guildMembers.id))
    .for('update', { of: guildMembers });
}

/**
 * Call after `deactivated_at` is cleared (same tx), with the value it had
 * ({@link lockDeactivatedAt}'s text).
 * @returns audits written.
 */
export async function auditOwnerReactivated(
  tx: AddonImportTx,
  userId: number,
  deactivatedAt: string,
  actorId: number | null,
): Promise<number> {
  await lockWonRows(tx, userId);
  const won = await tx
    .selectDistinct({
      characterId: characters.id,
      guid: characters.addonGuid,
      name: characters.name,
      gameId: characters.gameId,
      region: characters.region,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .innerJoin(characters, guidLink())
    .where(and(eq(characters.userId, userId), grantedSince(tx, deactivatedAt)));
  let written = 0;
  for (const { guid, ...rest } of won) {
    if (guid === null) continue;
    const via = 'owner_reactivated' as const;
    const createdAt = sql`clock_timestamp()`;
    const entry = { ...rest, guid, actorId, ownerId: userId, via, createdAt };
    await logGuidAudit(tx, { action: 'addon_guid_claimed', ...entry });
    written += 1;
  }
  return written;
}
