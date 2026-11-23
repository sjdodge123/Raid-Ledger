/**
 * ROK-2272 S10 — pure rules for Discord-only posts of NON-HUB polls and
 * lineups. The registry path is the exact complement of S7's hub path
 * (`guildId !== null`), so a subject lands on exactly one of them. Private
 * subjects never get a post (R6); a standalone poll's carrier lineup row is
 * never a lineup subject.
 */
import type { LineupSyncRow } from '../subject-discussion/lineup-discussion.queries';
import type { PollSyncRow } from '../subject-discussion/poll-discussion.queries';
import { pollEndedAt } from '../subject-discussion/poll-discussion.sync';

const ABSOLUTE = /^https?:\/\//i;

/** Still belongs on the registry path (non-hub, not private). */
export function pollOnPlanningPath(
  poll: Pick<PollSyncRow, 'guildId' | 'visibility'>,
): boolean {
  return poll.guildId === null && poll.visibility !== 'private';
}

/** Still belongs on the registry path (non-hub, not private, not a carrier). */
export function lineupOnPlanningPath(
  lineup: Pick<LineupSyncRow, 'guildId' | 'visibility' | 'standalone'>,
): boolean {
  return (
    lineup.guildId === null &&
    lineup.visibility !== 'private' &&
    !lineup.standalone
  );
}

/** A non-hub, public poll that is open (scheduling, not ended). */
export function pollEligible(poll: PollSyncRow, now: Date): boolean {
  return (
    pollOnPlanningPath(poll) &&
    poll.status === 'scheduling' &&
    pollEndedAt(poll, now) === null
  );
}

/** A non-hub, public, real lineup in its voting phase. */
export function lineupEligible(lineup: LineupSyncRow): boolean {
  return lineupOnPlanningPath(lineup) && lineup.status === 'voting';
}

/** Which page a subject post links to. */
export type PlanningSubjectLink =
  | { kind: 'poll'; lineupId: number; matchId: number }
  | { kind: 'lineup'; lineupId: number };

const LINES: Record<PlanningSubjectLink['kind'], [string, string]> = {
  poll: ['Plan this poll here.', 'Poll page'],
  lineup: ['Plan this lineup here.', 'Lineup page'],
};

function linkPath(link: PlanningSubjectLink): string {
  return link.kind === 'poll'
    ? `/community-lineup/${link.lineupId}/schedule/${link.matchId}`
    : `/community-lineup/${link.lineupId}`;
}

/**
 * The starter message: a short line + the subject's page (none when the
 * client URL is not absolute). A Discord-only post has no Raid Ledger
 * thread, so it never links to one.
 */
export function planningSubjectBody(
  clientUrl: string,
  link: PlanningSubjectLink,
): string {
  const [line, label] = LINES[link.kind];
  if (!ABSOLUTE.test(clientUrl)) return line;
  const base = clientUrl.replace(/\/+$/, '');
  return `${line}\n${label}: ${base}${linkPath(link)}`;
}
