/**
 * Private-lineup DM builders for lifecycle notifications (ROK-1115).
 *
 * These mirror the channel embeds suppressed for `visibility='private'`
 * lineups so invitees + creator still get the same lifecycle context via DM.
 * Kept in a sibling file to keep `lineup-notification-dm.helpers.ts` under
 * the 300-line ESLint ceiling.
 */
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type {
  DiscordMember,
  LineupDmInfo,
  MatchDmInfo,
} from './lineup-notification-dm.helpers';
import { DEDUP_TTL } from './lineup-notification.constants';

/** Send the per-invitee nomination-milestone DM (ROK-1115). */
export async function sendMilestoneDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupDmInfo,
  threshold: number,
  entryCount: number,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-milestone-dm:${lineup.id}:${threshold}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const titleSuffix = lineup.title ? ` — ${lineup.title}` : '';

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `${threshold}% of nominations filled${titleSuffix}`,
    message:
      `Your private lineup now has **${entryCount}** games nominated. ` +
      'Keep adding games before voting opens!',
    payload: {
      subtype: 'lineup_nomination_milestone',
      lineupId: lineup.id,
      threshold,
    },
  });
}

/** Send the per-invitee matches-found (decided phase) DM (ROK-1115). */
export async function sendMatchesFoundDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupDmInfo,
  matchCount: number,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-decided-dm:${lineup.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const titleSuffix = lineup.title ? ` — ${lineup.title}` : '';

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Results are in${titleSuffix}`,
    message:
      `Voting is closed on your private lineup. **${matchCount}** match` +
      `${matchCount === 1 ? '' : 'es'} ready to schedule. ` +
      'Top picks will move into scheduling next.',
    payload: {
      subtype: 'lineup_matches_found',
      lineupId: lineup.id,
    },
  });
}

/** Send the per-invitee scheduling-open DM for a private lineup (ROK-1115). */
export async function sendPrivateSchedulingDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchDmInfo,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-sched-invitee-dm:${match.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Vote on a time for ${match.gameName}`,
    message:
      `Your private lineup match for **${match.gameName}** is scheduling — ` +
      'vote on a time slot.',
    payload: {
      subtype: 'lineup_scheduling_open',
      matchId: match.id,
      lineupId: match.lineupId,
    },
  });
}

function formatEventWhen(eventDate: Date): string {
  return eventDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Send the per-invitee event-created DM for a private lineup (ROK-1115). */
export async function sendPrivateEventCreatedDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchDmInfo,
  member: DiscordMember,
  eventDate: Date,
  eventId: number | undefined,
): Promise<void> {
  const key = `lineup-event-invitee-dm:${match.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const when = formatEventWhen(eventDate);

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `${match.gameName} is happening!`,
    message:
      `**${match.gameName}** is locked in for ${when}. ` +
      'Sign up on the event page!',
    payload: {
      subtype: 'lineup_event_created',
      matchId: match.id,
      lineupId: match.lineupId,
      eventId,
    },
  });
}
