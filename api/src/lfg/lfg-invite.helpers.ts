/**
 * SQL predicates behind LFG player invites (ROK-1455 §8 Lane A).
 *
 * Every limit is a plain read over `lfg_invites` on the handle the caller
 * passes — the service hands in its transaction so the counts and the insert
 * see one snapshot under the advisory locks (D4/D5).
 *
 * Eligibility REUSES `eligibleUser()` (D10 / AC5) — there is deliberately no
 * second deactivated/banned literal in this file; a source guard in the
 * integration spec pins that.
 */
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { isDiscordSnowflake } from '../notifications/discord-notification.constants';
import { eligibleUser, liveIntent, type LfgDb } from './lfg-query.helpers';
import { LFG_INVITE_NOTIFICATION_TYPE } from './lfg-invite.constants';

export type LfgInviteRow = typeof schema.lfgInvites.$inferSelect;

/** Invites `recipientUserId` received from ANY group since `since` (AC2). */
export async function countRecipientInvitesSince(
  db: LfgDb,
  recipientUserId: number,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.recipientUserId, recipientUserId),
        gt(schema.lfgInvites.sentAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Invites the group for `gameId` sent since `since` (AC3). */
export async function countGroupInvitesSince(
  db: LfgDb,
  gameId: number,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.gameId, gameId),
        gt(schema.lfgInvites.sentAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * The most recent invite for `(recipient, game)` inside the horizon, declined
 * or not — either one blocks a repeat (AC4).
 */
export async function findLiveInviteFor(
  db: LfgDb,
  recipientUserId: number,
  gameId: number,
  horizonStart: Date,
): Promise<LfgInviteRow | null> {
  const [row] = await db
    .select()
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.recipientUserId, recipientUserId),
        eq(schema.lfgInvites.gameId, gameId),
        gt(schema.lfgInvites.sentAt, horizonStart),
      ),
    )
    .orderBy(sql`${schema.lfgInvites.sentAt} DESC`)
    .limit(1);
  return row ?? null;
}

/** Neither deactivated nor banned — the shared ROK-313 predicate (D10). */
export async function recipientIsEligible(
  db: LfgDb,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eligibleUser()))
    .limit(1);
  return row !== undefined;
}

/**
 * A real Discord snowflake is linked — checked BEFORE the insert so the
 * budget is never spent on a DM that cannot be delivered (§10). Mirrors the
 * `resolveDiscordId` test the dispatcher applies again downstream.
 */
export async function recipientHasLinkedDiscord(
  db: LfgDb,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return isDiscordSnowflake(row?.discordId);
}

/**
 * The stored `discord` preference for the invite type, read the way the
 * dispatcher reads it (`isTypeDisabledForUser`): ONLY a literal
 * `discord: false` opts out; a missing key or a missing row sends (D2, T-A9).
 */
export async function recipientOptedOut(
  db: LfgDb,
  userId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ prefs: schema.userNotificationPreferences.channelPrefs })
    .from(schema.userNotificationPreferences)
    .where(eq(schema.userNotificationPreferences.userId, userId))
    .limit(1);
  const typePrefs = (
    row?.prefs as Partial<Record<string, Partial<Record<string, boolean>>>>
  )?.[LFG_INVITE_NOTIFICATION_TYPE];
  return typePrefs?.discord === false;
}

/** Already in the group — the same read the affinity DM uses (§10). */
export async function holdsLiveIntent(
  db: LfgDb,
  userId: number,
  gameId: number,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
        liveIntent(now),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Write the durable record — the same transaction that counted (D4). */
export async function insertInvite(
  db: LfgDb,
  input: { recipientUserId: number; inviterUserId: number; gameId: number },
): Promise<LfgInviteRow> {
  const [row] = await db.insert(schema.lfgInvites).values(input).returning();
  return row;
}

/**
 * Of `userIds`, those the group for `gameId` invited inside the horizon —
 * the `inviteState` projection for the suggestions read (D7). Declined rows
 * count: the wire never distinguishes them from `sent`.
 */
export async function findInvitedUserIds(
  db: LfgDb,
  gameId: number,
  userIds: number[],
  horizonStart: Date,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: schema.lfgInvites.recipientUserId })
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.gameId, gameId),
        inArray(schema.lfgInvites.recipientUserId, userIds),
        gt(schema.lfgInvites.sentAt, horizonStart),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** The decline effect (D12): stamp the clicker's newest un-declined live row. */
export async function declineLiveInvite(
  db: LfgDb,
  recipientUserId: number,
  gameId: number,
  now: Date,
): Promise<LfgInviteRow | null> {
  const target = await db
    .select({ id: schema.lfgInvites.id })
    .from(schema.lfgInvites)
    .where(
      and(
        eq(schema.lfgInvites.recipientUserId, recipientUserId),
        eq(schema.lfgInvites.gameId, gameId),
        isNull(schema.lfgInvites.declinedAt),
      ),
    )
    .orderBy(sql`${schema.lfgInvites.sentAt} DESC`)
    .limit(1);
  if (!target[0]) return null;
  const [row] = await db
    .update(schema.lfgInvites)
    .set({ declinedAt: now })
    .where(eq(schema.lfgInvites.id, target[0].id))
    .returning();
  return row ?? null;
}
