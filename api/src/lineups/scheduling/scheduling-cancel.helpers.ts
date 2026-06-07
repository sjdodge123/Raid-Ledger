/**
 * Cancel-poll voter-notification builders (ROK-1219 / F-38).
 *
 * Extracted from scheduling.service.ts (near the 300-line ESLint cap) so the
 * notification-shaping logic lives in its own focused module. Mirrors the
 * established scheduling-poll notification pattern: type `community_lineup`
 * with a `payload.subtype` discriminator (see
 * `notifications/scheduling-threshold.helpers.ts`).
 */
import type { CreateNotificationInput } from '../../notifications/notification.types';

/** Inputs needed to shape a poll-cancellation notification batch. */
export interface CancelNotificationContext {
  lineupId: number;
  matchId: number;
  gameName: string;
  /** Trimmed reason, or null when none/whitespace-only was supplied. */
  reason: string | null;
  /** Matched member user ids, with the cancelling actor already excluded. */
  recipientUserIds: number[];
}

/**
 * Build the human-readable cancellation message. Appends a `Reason: …` suffix
 * only when a reason was provided (mirrors event-lifecycle cancellation tone).
 */
export function buildCancelMessage(gameName: string, reason: string | null): string {
  const base = `The ${gameName} scheduling poll was cancelled.`;
  return reason ? `${base} Reason: ${reason}` : base;
}

/**
 * Build a `community_lineup` notification for each recipient. Returns an empty
 * array when there are no recipients (e.g. an actor-only match), so callers can
 * pass the result straight to `NotificationService.createMany`.
 */
export function buildCancelNotifications(
  ctx: CancelNotificationContext,
): CreateNotificationInput[] {
  const message = buildCancelMessage(ctx.gameName, ctx.reason);
  return ctx.recipientUserIds.map((userId) => ({
    userId,
    type: 'community_lineup' as const,
    title: 'Poll cancelled',
    message,
    payload: {
      subtype: 'scheduling_poll_cancelled',
      lineupId: ctx.lineupId,
      matchId: ctx.matchId,
      gameName: ctx.gameName,
      reason: ctx.reason,
    },
  }));
}

/** Normalize a raw reason: trim, treat empty/whitespace-only as no reason. */
export function normalizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}
