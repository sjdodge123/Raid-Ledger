/**
 * DM dispatch helpers for Community Lineup notifications (ROK-932).
 * Extracts per-user DM dispatch logic from LineupNotificationService
 * to keep the orchestrator under the 300-line file limit.
 */
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DEDUP_TTL } from './lineup-notification.constants';

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
  title?: string;
}

/**
 * Send an invite DM for a private lineup (ROK-1065).
 * The body includes the lineup title so the smoke test can match on it,
 * and the DM is scoped per-invitee via a dedup key distinct from the
 * voting-open key.
 */
export async function sendPrivateInviteDM(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupDmInfo,
  member: DiscordMember,
): Promise<void> {
  const key = `lineup-invite-dm:${lineup.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const title = lineup.title ?? `Lineup #${lineup.id}`;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `You're invited: ${title}`,
    message: `You've been invited to the private Community Lineup "${title}". Head to the site to nominate and vote.`,
    payload: {
      subtype: 'lineup_invite',
      lineupId: lineup.id,
    },
  });
}

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
  const titleSuffix = lineup.title ? ` — ${lineup.title}` : '';

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Time to vote on the Community Lineup${titleSuffix}!`,
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
  eventId?: number,
): Promise<void> {
  const key = `lineup-event-dm:${match.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `${match.gameName} is happening!`,
    message: `${match.gameName} is locked in for ${eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Sign up!`,
    payload: {
      subtype: 'lineup_event_created',
      matchId: match.id,
      lineupId: match.lineupId,
      eventId,
    },
  });
}
