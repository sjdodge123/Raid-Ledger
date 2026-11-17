/**
 * ROK-2217 Codex P2: atomic claim of a member invite.
 *
 * The repeat-invite check and the notification insert used to run as two
 * separate statements, so two concurrent invites for the same
 * (event, recipient) both saw no pending invite and both sent a DM. The claim
 * now runs in one transaction holding `pg_advisory_xact_lock` on that pair:
 * the second request waits, then sees the first one's row and is skipped.
 *
 * A lock instead of a unique index because the notifications table has no key
 * that can express "one pending invite per event" without a migration, and
 * postgres.js poisons the whole transaction on a failed statement, so
 * catch-and-retry is not an option. Every read and write here uses `tx`; the
 * caller emits the Discord DM only after this resolves (the claim committed).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import {
  hasPendingMemberInvite,
  MEMBER_INVITE_TITLE,
} from './event-invite-state.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Advisory-lock class for member-invite claims (ROK-2217). */
export const MEMBER_INVITE_LOCK_CLASS = 2217;

/** The invite notification to claim for `userId` on `eventId`. */
export interface MemberInviteNotice {
  eventId: number;
  userId: number;
  inviterName: string;
  eventTitle: string;
}

/**
 * `claimed: false` — the member already holds an unanswered invite; nothing
 * was written. `claimed: true` — the invite is ours; `notificationId` is the
 * new row, or null when the member turned in-app event notices off (no row,
 * no DM — what `NotificationService.create` did for a muted category).
 */
export type MemberInviteClaim =
  { claimed: false } | { claimed: true; notificationId: string | null };

/** Hold the `(eventId, userId)` invite lock until `tx` commits or rolls back. */
async function lockMemberInvite(
  tx: Db,
  eventId: number,
  userId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${MEMBER_INVITE_LOCK_CLASS}::int4, hashtext(${`${eventId}:${userId}`}))`,
  );
}

/** Insert the invite notification on `tx`; resolves its id. */
async function insertInviteNotification(
  tx: Db,
  notice: MemberInviteNotice,
): Promise<string | null> {
  const [row] = await tx
    .insert(schema.notifications)
    .values({
      userId: notice.userId,
      type: 'new_event',
      title: MEMBER_INVITE_TITLE,
      message: `${notice.inviterName} invited you to "${notice.eventTitle}"`,
      payload: { eventId: notice.eventId, invitedBy: notice.inviterName },
    })
    .returning({ id: schema.notifications.id });
  return row?.id ?? null;
}

/**
 * Check-and-insert under the per-(event, recipient) lock. The preference read
 * runs BEFORE the transaction so no second pool connection is needed while
 * the lock is held. Mirrors `NotificationService.isCategoryEnabled`.
 */
export async function claimMemberInvite(
  db: Db,
  notificationService: NotificationService,
  notice: MemberInviteNotice,
): Promise<MemberInviteClaim> {
  const prefs = await notificationService.getPreferences(notice.userId);
  const inApp = prefs.channelPrefs.new_event?.inApp ?? true;
  return db.transaction(async (tx): Promise<MemberInviteClaim> => {
    await lockMemberInvite(tx, notice.eventId, notice.userId);
    if (await hasPendingMemberInvite(tx, notice.eventId, notice.userId)) {
      return { claimed: false };
    }
    if (!inApp) return { claimed: true, notificationId: null };
    const notificationId = await insertInviteNotification(tx, notice);
    return { claimed: true, notificationId };
  });
}
