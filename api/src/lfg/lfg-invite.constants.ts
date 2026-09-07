/**
 * The numbers behind LFG player invites (ROK-1455 §7).
 *
 * Every value here is `DEFAULT (operator may override)`. Never inline any of
 * them — the same rule `lfg.constants.ts` states for `LFG_EXPIRY_DAYS` — and
 * tests read THESE, never the literals, so a tuned number cannot break a test.
 */
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import { LFG_EXPIRY_DAYS } from './lfg.constants';

/** The notification type a player-sent invite ships as (D1). */
export const LFG_INVITE_NOTIFICATION_TYPE: NotificationType =
  'lfg_player_invite';

/** Invites one recipient may receive across ALL groups per window (AC2). */
export const LFG_INVITE_RECIPIENT_LIMIT = 3;

/** Rolling window for {@link LFG_INVITE_RECIPIENT_LIMIT}, in hours. */
export const LFG_INVITE_RECIPIENT_WINDOW_HOURS = 24;

/** Invites one group (= one game) may send per window (AC3). */
export const LFG_INVITE_GROUP_CAP = 6;

/** Rolling window for {@link LFG_INVITE_GROUP_CAP}, in hours. */
export const LFG_INVITE_GROUP_WINDOW_HOURS = 24;

/**
 * How long one `(recipient, game)` invite — sent or declined — blocks another
 * (AC4). Imported, not re-typed: an invite stops repeating for exactly as long
 * as the intent that motivated it can live (D14).
 */
export const LFG_INVITE_NO_REPEAT_DAYS = LFG_EXPIRY_DAYS;

/** The one honest refusal — the 429 body when the group cap is spent (D13). */
export const LFG_INVITE_GROUP_CAP_MESSAGE = `This group has sent its ${LFG_INVITE_GROUP_CAP} invites for the day. Try again tomorrow.`;

/**
 * The 429 body's discriminator. The API also has a GLOBAL `ThrottlerGuard`
 * that answers 429 with its own generic copy, so "429" alone cannot tell the
 * group cap from ordinary rate limiting — the client must branch on this code
 * before it paints the cap notice and locks the panel (F1).
 */
export const LFG_INVITE_GROUP_CAP_CODE = 'LFG_INVITE_GROUP_CAP' as const;

/** The one opaque refusal every recipient-scoped skip collapses into (D13). */
export const LFG_INVITE_SKIP_REASON = 'unavailable' as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Start of the per-recipient window measured back from `now`. */
export function recipientWindowStart(now: Date): Date {
  return new Date(now.getTime() - LFG_INVITE_RECIPIENT_WINDOW_HOURS * HOUR_MS);
}

/** Start of the per-group window measured back from `now`. */
export function groupWindowStart(now: Date): Date {
  return new Date(now.getTime() - LFG_INVITE_GROUP_WINDOW_HOURS * HOUR_MS);
}

/** Start of the no-repeat horizon measured back from `now`. */
export function noRepeatHorizonStart(now: Date): Date {
  return new Date(now.getTime() - LFG_INVITE_NO_REPEAT_DAYS * DAY_MS);
}

/**
 * Advisory-lock keys for the invite transaction (D5).
 *
 * Taken in a FIXED order — recipient first, then game — with the one-argument
 * `pg_advisory_xact_lock(bigint)` form, so the keyspace is disjoint from
 * `withGameNameLock`'s two-argument family (ROK-1438) and the strings differ
 * from `lfgGroupLockKey`'s `lfg:{gameId}`, so the +1 path cannot collide.
 *
 * The recipient lock is the race-tight one: the issue's failure mode is three
 * groups inviting the same six people, which a game-only lock would not
 * serialise. Fixed acquisition order is what makes two concurrent invites
 * deadlock-free.
 */
export function lfgInviteRecipientLockKey(recipientUserId: number): string {
  return `lfg-invite:recipient:${recipientUserId}`;
}

/** See {@link lfgInviteRecipientLockKey} — always taken SECOND. */
export function lfgInviteGameLockKey(gameId: number): string {
  return `lfg-invite:game:${gameId}`;
}
