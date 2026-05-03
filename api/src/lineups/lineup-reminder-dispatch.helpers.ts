/**
 * DM dispatch helpers for the lineup phase reminder cron (ROK-1126).
 *
 * Composed by `LineupReminderService` — each helper checks the dedup
 * cache, builds the windowed copy, and creates a `community_lineup`
 * notification. Kept in its own file to keep the service under the
 * 300-line ESLint ceiling.
 */
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DEDUP_TTL } from './lineup-notification.constants';

interface DispatchDeps {
  notificationService: NotificationService;
  dedupService: NotificationDedupService;
}

export async function sendVoteReminder(
  deps: DispatchDeps,
  lineupId: number,
  userId: number,
  window: '24h' | '1h',
): Promise<void> {
  const key = `lineup-reminder-${window}:${lineupId}:${userId}`;
  if (await deps.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const message =
    window === '1h'
      ? 'Last chance to vote -- voting closes in 1 hour'
      : "You haven't voted yet -- voting closes in 24 hours";
  await deps.notificationService.create({
    userId,
    type: 'community_lineup',
    title: 'Vote Reminder',
    message,
    payload: { subtype: 'lineup_vote_reminder', lineupId },
  });
}

export async function sendSchedulingReminder(
  deps: DispatchDeps,
  matchId: number,
  userId: number,
  window: '24h' | '1h',
): Promise<void> {
  const key = `lineup-sched-remind:${matchId}:${userId}:${window}`;
  if (await deps.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  await deps.notificationService.create({
    userId,
    type: 'community_lineup',
    title: 'Scheduling Reminder',
    message: 'Your match is waiting -- pick a time!',
    payload: { subtype: 'lineup_scheduling_reminder', matchId },
  });
}

export async function sendNominationReminder(
  deps: DispatchDeps,
  lineupId: number,
  userId: number,
  window: '24h' | '1h',
): Promise<void> {
  const key = `lineup-nominate-remind:${lineupId}:${userId}:${window}`;
  if (await deps.dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const message =
    window === '1h'
      ? 'Last chance to nominate -- the building phase closes in 1 hour'
      : 'Nominations are closing in 24 hours -- add your picks before the cut';
  await deps.notificationService.create({
    userId,
    type: 'community_lineup',
    title: 'Nomination Reminder',
    message,
    payload: { subtype: 'lineup_nominate_reminder', lineupId },
  });
}
