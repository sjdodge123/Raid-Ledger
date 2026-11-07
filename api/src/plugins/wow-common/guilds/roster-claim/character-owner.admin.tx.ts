import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  type Logger,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import * as schema from '../../../../drizzle/schema';
import { autoPromoteAfterDelete } from '../../../../characters/characters-crud.helpers';
import type { AddonImportTx } from '../../addon-import/addon-import-apply.types';
import {
  lockAddonGuid,
  lockClaimName,
} from '../../addon-import/addon-import.locks';
import {
  CHARACTER_CLAIM_ENTITY,
  logCharacterClaimAudit,
} from './roster-claim.audit';

/**
 * ROK-2128 (D6, FLAG 10) — the admin "Change owner" transaction plus the
 * shared helpers the widened ROK-1756 unlink reuses. Lock order matches the
 * claim and LedgerLink applies: GUID lock (1) → name lock (3) → row lock.
 */
const { characters, users, eventSignups, events, activityLog } = schema;

export type CharacterRow = typeof characters.$inferSelect;

/** Where a roster-claimed character came from (its `roster_claimed` audit). */
export interface RosterOrigin {
  guildId: number | null;
  memberId: number | null;
}

/** The character's `roster_claimed` origin, or null when it was never picked. */
export async function rosterOriginOf(
  tx: AddonImportTx,
  characterId: string,
): Promise<RosterOrigin | null> {
  const [row] = await tx
    .select({ metadata: activityLog.metadata })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entityType, CHARACTER_CLAIM_ENTITY),
        eq(activityLog.action, 'roster_claimed'),
        sql`${activityLog.metadata}->>'characterId' = ${characterId}`,
      ),
    )
    .orderBy(desc(activityLog.id))
    .limit(1);
  if (!row) return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return { guildId: num(meta.guildId), memberId: num(meta.memberId) };
}

/**
 * Take the identity locks for `row`, then `FOR UPDATE` re-read it; 409 when a
 * concurrent writer changed the owner or GUID between the read and the lock.
 */
export async function lockCharacter(
  tx: AddonImportTx,
  row: CharacterRow,
): Promise<CharacterRow> {
  if (row.addonGuid && row.region)
    await lockAddonGuid(tx, row.gameId, row.region, row.addonGuid);
  if (row.region) await lockClaimName(tx, row.gameId, row.region, row.name);
  const [locked] = await tx
    .select()
    .from(characters)
    .where(eq(characters.id, row.id))
    .for('update');
  if (
    !locked ||
    locked.userId !== row.userId ||
    locked.addonGuid !== row.addonGuid
  )
    throw new ConflictException('That character changed; reload and retry.');
  return locked;
}

/** Read a character or 404. */
export async function readCharacter(
  tx: AddonImportTx,
  id: string,
): Promise<CharacterRow> {
  const [row] = await tx.select().from(characters).where(eq(characters.id, id));
  if (!row) throw new NotFoundException('Character not found');
  return row;
}

/** Target must exist, be active, differ from the owner and not hold the name. */
async function assertTarget(
  tx: AddonImportTx,
  row: CharacterRow,
  targetId: number,
): Promise<string> {
  const [user] = await tx.select().from(users).where(eq(users.id, targetId));
  if (!user) throw new NotFoundException('User not found');
  if (user.deactivatedAt)
    throw new BadRequestException('That user is deactivated.');
  if (user.id === row.userId)
    throw new ConflictException('That player already owns this character.');
  const [dup] = await tx
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.userId, targetId),
        eq(characters.gameId, row.gameId),
        ne(characters.id, row.id),
        sql`lower(${characters.name}) = lower(${row.name})`,
      ),
    )
    .limit(1);
  if (dup) throw new ConflictException(`That player already has ${row.name}.`);
  return user.displayName ?? user.username;
}

/** FLAG 10 — the old owner's not-yet-started signups on it drop the character. */
async function detachFutureSignups(
  tx: AddonImportTx,
  row: CharacterRow,
): Promise<void> {
  const future = tx
    .select({ id: events.id })
    .from(events)
    .where(
      sql`lower(${events.duration}) > ${new Date().toISOString()}::timestamptz`,
    );
  await tx
    .update(eventSignups)
    .set({ characterId: null })
    .where(
      and(
        eq(eventSignups.characterId, row.id),
        eq(eventSignups.userId, row.userId),
        inArray(eventSignups.eventId, future),
      ),
    );
}

/** Whether `userId` already has a main of `gameId`. */
async function hasMain(
  tx: AddonImportTx,
  userId: number,
  gameId: number,
): Promise<boolean> {
  const [main] = await tx
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.userId, userId),
        eq(characters.gameId, gameId),
        eq(characters.isMain, true),
      ),
    )
    .limit(1);
  return main !== undefined;
}

export interface ReassignArgs {
  adminId: number;
  characterId: string;
  toUserId: number;
  logger: Logger;
}

/** What the caller needs after commit to notify both players. */
export interface ReassignOutcome {
  row: CharacterRow;
  toUserId: number;
  toName: string;
}

/** The whole Change owner inside `tx`: move, mains, FLAG 10, audit. */
export async function reassignWithin(
  tx: AddonImportTx,
  args: ReassignArgs,
): Promise<ReassignOutcome> {
  const row = await lockCharacter(
    tx,
    await readCharacter(tx, args.characterId),
  );
  const toName = await assertTarget(tx, row, args.toUserId);
  const isMain = !(await hasMain(tx, args.toUserId, row.gameId));
  await detachFutureSignups(tx, row);
  await tx
    .update(characters)
    .set({ userId: args.toUserId, isMain, updatedAt: new Date() })
    .where(eq(characters.id, row.id));
  await autoPromoteAfterDelete(tx, row.userId, row.gameId, args.logger);
  const origin = await rosterOriginOf(tx, row.id);
  await logCharacterClaimAudit(tx, {
    action: 'admin_reassigned',
    ownerId: args.toUserId,
    actorId: args.adminId,
    characterId: row.id,
    name: row.name,
    guildId: origin?.guildId ?? null,
    memberId: origin?.memberId ?? null,
    fromUserId: row.userId,
    toUserId: args.toUserId,
  });
  return { row, toUserId: args.toUserId, toName };
}
