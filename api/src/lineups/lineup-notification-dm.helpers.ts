/**
 * DM dispatch helpers for Community Lineup notifications (ROK-932).
 * Extracts per-user DM dispatch logic from LineupNotificationService
 * to keep the orchestrator under the 300-line file limit.
 */
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';

/** Shape of a Discord-linked member returned from queries. */
export interface DiscordMember {
  id: number;
  userId: number;
  displayName: string;
  discordId: string;
}

/** Shape of a match for DM dispatch. */
export interface MatchDmInfo {
  id: number;
  lineupId: number;
  gameName: string;
}

/** Shape of a lineup for voting DMs. */
export interface LineupDmInfo {
  id: number;
}

/** TTL for dedup records (7 days). */
const DEDUP_TTL = 7 * 24 * 3600;

/** Send a single voting-open DM to a member. */
export async function sendVotingDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupDmInfo,
  member: DiscordMember,
  gameCount: number,
): Promise<void> {
  const key = `lineup-vote-dm:${lineup.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: 'Time to vote on the Community Lineup!',
    message: `${gameCount} games are on the ballot — pick your favorites before voting closes.`,
    payload: {
      subtype: 'lineup_voting_open',
      lineupId: lineup.id,
    },
  });
}

/** Send a single scheduling-open DM to a match member. */
export async function sendSchedulingDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchDmInfo,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-sched-dm:${match.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Vote on a time for ${match.gameName}`,
    message: `Your match for ${match.gameName} is scheduling -- vote on a time!`,
    payload: {
      subtype: 'lineup_scheduling_open',
      matchId: match.id,
      lineupId: match.lineupId,
    },
  });
}

/** Send a single event-created DM to a match member. */
export async function sendEventCreatedDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchDmInfo,
  member: DiscordMember,
  eventDate: Date,
): Promise<void> {
  const key = `lineup-event-dm:${match.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `${match.gameName} is happening!`,
    message: `${match.gameName} is locked in for ${eventDate.toISOString()}. Sign up!`,
    payload: {
      subtype: 'lineup_event_created',
      matchId: match.id,
      lineupId: match.lineupId,
    },
  });
}
