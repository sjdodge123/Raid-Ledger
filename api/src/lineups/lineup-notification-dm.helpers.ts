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
  /** Operator-authored markdown description (ROK-1063). */
  description?: string | null;
  /** Optional target play date, shown as Discord-native timestamp. */
  targetDate?: Date;
  /** Optional voting deadline, shown in the voting-open DM. */
  votingDeadline?: Date;
}

/** Format a Date as a Discord-native relative+absolute timestamp. */
function discordTs(d: Date): string {
  const sec = Math.floor(d.getTime() / 1000);
  return `<t:${sec}:F> (<t:${sec}:R>)`;
}

/** Phase-flow breadcrumb shared across lineup DMs (matches channel embeds). */
const PHASE_FLOW =
  '1. \u{1F539} **Nominations** — suggest games to play\n' +
  '2. \u2796 **Voting** — pick your favorites from the nominees\n' +
  '3. \u2796 **Scheduling** — top picks are matched, scheduled, and played!';

/** Compose the invite DM body, mirroring the channel "Nominations Open" embed. */
function composeInviteMessage(lineup: LineupDmInfo): string {
  const title = lineup.title ?? `Lineup #${lineup.id}`;
  const desc = lineup.description ? `${lineup.description}\n\n` : '';
  const deadline = lineup.targetDate
    ? `\n\n\u{1F4C5} **Target play date:** ${discordTs(lineup.targetDate)}`
    : '';
  return (
    `${desc}You've been invited to the private Community Lineup **${title}**.\n\n` +
    'Nominate games now; voting opens automatically once nominations close. ' +
    'Phases advance on their own as each deadline passes:\n\n' +
    `${PHASE_FLOW}\n\n` +
    '\u{1F512} Only invitees (plus admins) can nominate or vote on this lineup — ' +
    'the channel stays silent.' +
    deadline
  );
}

/** Compose the voting-open DM body, mirroring the channel "Voting Open" embed. */
function composeVotingMessage(
  lineup: LineupDmInfo,
  games: ReadonlyArray<{ id: number; name: string }>,
  baseUrl?: string,
): string {
  const desc = lineup.description ? `${lineup.description}\n\n` : '';
  const deadline = lineup.votingDeadline
    ? `\n\n\u23F0 **Voting closes:** ${discordTs(lineup.votingDeadline)}`
    : '';
  const ballot = buildBallot(games, baseUrl);
  return (
    `${desc}Nominations are closed — voting is now open on your private lineup. ` +
    'Pick the games you most want to play; each member gets a limited number ' +
    'of votes, so choose wisely.' +
    ballot +
    deadline
  );
}

/** Render up to 15 nominees as a bulleted ballot, matching the channel embed. */
function buildBallot(
  games: ReadonlyArray<{ id: number; name: string }>,
  baseUrl?: string,
): string {
  if (games.length === 0) return '';
  const lines = games.slice(0, 15).map((g) => {
    const label = baseUrl
      ? `[**${g.name}**](${baseUrl}/games/${g.id})`
      : `**${g.name}**`;
    return `\u{1F3AE} ${label}`;
  });
  const overflow =
    games.length > 15 ? `\n*...and ${games.length - 15} more*` : '';
  return `\n\n**Games on the Ballot (${games.length})**\n${lines.join('\n')}${overflow}`;
}

/**
 * Send an invite DM for a private lineup (ROK-1065).
 * Body mirrors the "Nominations Open" channel embed so invitees get the
 * same phase-flow context. Dedup key is distinct from the voting-open key.
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
    message: composeInviteMessage(lineup),
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
  games: ReadonlyArray<{ id: number; name: string }>,
  baseUrl?: string,
): Promise<void> {
  const key = `lineup-vote-dm:${lineup.id}:${member.userId}`;
  if (await dedupService.checkAndMarkSent(key, DEDUP_TTL)) return;
  const titleSuffix = lineup.title ? ` — ${lineup.title}` : '';

  await notificationService.create({
    userId: member.userId,
    type: 'community_lineup',
    title: `Time to vote on the Community Lineup${titleSuffix}!`,
    message: composeVotingMessage(lineup, games, baseUrl),
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
