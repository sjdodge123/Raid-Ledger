/**
 * Query helpers for scheduling threshold notifications (ROK-1015).
 * Extracted for file size compliance and testability.
 */
import type { CreateNotificationInput } from './notification.types';

/** Shape returned by the eligible polls query. */
export interface EligiblePollRow {
  matchId: number;
  lineupId: number;
  gameId: number;
  gameName: string;
  creatorId: number;
  minVoteThreshold: number;
  uniqueVoterCount: number;
}

/**
 * Build the notification message for a threshold-met poll.
 * Format: "X of Y members have voted on your <Game> poll"
 */
export function buildThresholdMessage(poll: EligiblePollRow): string {
  return (
    `${poll.uniqueVoterCount} of ${poll.minVoteThreshold} members ` +
    `have voted on your ${poll.gameName} poll`
  );
}

/**
 * Build a CreateNotificationInput for a threshold-met poll.
 * Notification type is community_lineup with subtype scheduling_poll_threshold_met.
 */
export function buildThresholdNotification(
  poll: EligiblePollRow,
): CreateNotificationInput {
  return {
    userId: poll.creatorId,
    type: 'community_lineup',
    title: 'Poll ready for review',
    message: buildThresholdMessage(poll),
    payload: {
      subtype: 'scheduling_poll_threshold_met',
      lineupId: poll.lineupId,
      matchId: poll.matchId,
    },
  };
}
