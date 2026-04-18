/**
 * DM builders for Community Lineup notifications (ROK-932, extracted in ROK-1063).
 * Keeps lineup-notification.service.ts under the 300-line ESLint limit.
 */
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DEDUP_TTL } from './lineup-notification.constants';

/** Send a deduped DM via the notification service. */
export async function sendDedupedDM(
  dedupService: NotificationDedupService,
  notificationService: NotificationService,
  dedupKey: string,
  payload: Parameters<NotificationService['create']>[0],
): Promise<void> {
  if (await dedupService.checkAndMarkSent(dedupKey, DEDUP_TTL)) return;
  await notificationService.create(payload);
}

/** Build the match-member DM (AC-6). */
export async function dispatchMatchMemberDM(
  dedupService: NotificationDedupService,
  notificationService: NotificationService,
  args: {
    matchId: number;
    userId: number;
    gameName: string;
    coPlayers: string[];
    lineupId: number;
  },
): Promise<void> {
  const coList = args.coPlayers.length
    ? args.coPlayers.join(', ')
    : 'your group';
  await sendDedupedDM(
    dedupService,
    notificationService,
    `lineup-match-dm:${args.matchId}:${args.userId}`,
    {
      userId: args.userId,
      type: 'community_lineup',
      title: `You're matched for ${args.gameName}!`,
      message: `You're in a match for ${args.gameName} with ${coList}. Schedule a time!`,
      payload: {
        subtype: 'lineup_match_member',
        matchId: args.matchId,
        lineupId: args.lineupId,
        gameName: args.gameName,
      },
    },
  );
}

/** Build the rally-interest DM (AC-7). */
export async function dispatchRallyInterestDM(
  dedupService: NotificationDedupService,
  notificationService: NotificationService,
  args: {
    matchId: number;
    userId: number;
    gameName: string;
    lineupId: number;
  },
): Promise<void> {
  await sendDedupedDM(
    dedupService,
    notificationService,
    `lineup-rally-dm:${args.matchId}:${args.userId}`,
    {
      userId: args.userId,
      type: 'community_lineup',
      title: `${args.gameName} needs more interest!`,
      message: `${args.gameName} almost has enough players. Join the match!`,
      payload: {
        subtype: 'lineup_rally_interest',
        matchId: args.matchId,
        lineupId: args.lineupId,
        gameName: args.gameName,
      },
    },
  );
}

/** Build the nomination-removed DM (AC-16). */
export async function dispatchNominationRemovedDM(
  dedupService: NotificationDedupService,
  notificationService: NotificationService,
  args: {
    lineupId: number;
    gameId: number;
    gameName: string;
    userId: number;
    operatorName: string;
  },
): Promise<void> {
  await sendDedupedDM(
    dedupService,
    notificationService,
    `lineup-removed-dm:${args.lineupId}:${args.gameId}:${args.userId}`,
    {
      userId: args.userId,
      type: 'community_lineup',
      title: 'Nomination removed',
      message: `Your nomination ${args.gameName} was removed by ${args.operatorName}.`,
      payload: {
        subtype: 'lineup_nomination_removed',
        lineupId: args.lineupId,
        gameId: args.gameId,
        gameName: args.gameName,
      },
    },
  );
}
