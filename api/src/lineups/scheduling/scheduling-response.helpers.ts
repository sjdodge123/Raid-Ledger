/**
 * Response mapping helpers for scheduling poll (ROK-965).
 * Pure functions that transform DB rows into response DTOs.
 */
import type {
  SchedulePollPageResponseDto,
  MatchDetailResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import type { MatchMemberRow } from '../lineups-match-query.helpers';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

type SlotRow = {
  id: number;
  matchId: number;
  proposedTime: Date;
  overlapScore: string | null;
  suggestedBy: string;
  createdAt: Date;
};

type MatchRow = {
  id: number;
  lineupId: number;
  gameId: number;
  status: string;
  thresholdMet: boolean;
  voteCount: number;
  votePercentage: string | null;
  fitType: string | null;
  linkedEventId: number | null;
  minVoteThreshold: number | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Map a match row + members to a MatchDetailResponseDto. */
export function buildMatchDetailDto(
  match: MatchRow,
  members: MatchMemberRow[],
  gameName: string,
  gameCoverUrl: string | null,
  lineupCreatedById: number | null = null,
  playerCap: number | null = null,
  followupForEventId: number | null = null,
): MatchDetailResponseDto {
  return {
    id: match.id,
    lineupId: match.lineupId,
    gameId: match.gameId,
    status: match.status as MatchDetailResponseDto['status'],
    thresholdMet: match.thresholdMet,
    voteCount: match.voteCount,
    votePercentage: match.votePercentage ? Number(match.votePercentage) : null,
    fitType: match.fitType as MatchDetailResponseDto['fitType'],
    linkedEventId: match.linkedEventId,
    minVoteThreshold: match.minVoteThreshold ?? null,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    gameName,
    gameCoverUrl,
    // ROK-1411: per-game player cap (games.player_count.max); null when unknown.
    playerCap,
    // The ended event this follow-up poll came from; null for ordinary polls.
    followupForEventId,
    ...(lineupCreatedById !== null ? { lineupCreatedById } : {}),
    members: members.map((m) => ({
      id: m.id,
      matchId: m.matchId,
      userId: m.userId,
      source: m.source as 'voted' | 'bandwagon',
      createdAt: m.createdAt.toISOString(),
      // ROK-1545 (F-05): the late-joiner catch-up line compares this against
      // when voting started, so the member row names it explicitly.
      joinedAt: m.createdAt.toISOString(),
      displayName: m.displayName,
      avatar: m.avatar,
      discordId: m.discordId,
      customAvatarUrl: m.customAvatarUrl,
      // ROK-1296: per-match scheduling submission timestamp.
      schedulingSubmittedAt: m.schedulingSubmittedAt?.toISOString() ?? null,
    })),
  };
}

/** Strip a vote row down to the voter identity both stance lists carry. */
function toVoter(v: ScheduleVoteRow) {
  return {
    userId: v.userId,
    displayName: v.displayName,
    avatar: v.avatar ?? null,
    discordId: v.discordId ?? null,
    customAvatarUrl: v.customAvatarUrl ?? null,
  };
}

/**
 * Map slot rows + votes into enriched slot DTOs.
 *
 * ROK-1617: `votes` stays YES-ONLY. Every surface that reads `votes.length` as
 * the slot's vote count predates the stance column, and folding `no`s into it
 * would inflate the leading calculation on exactly the slots the `no`s were
 * meant to push DOWN. The `no`s get their own array instead.
 *
 * Consequence for "N of M have voted" (the early-create confirm modal): the
 * distinct ANSWERERS of a slot are `votes` ∪ `noVotes`, since a member who
 * rejected the time has still answered. A client counting `votes` alone is
 * counting supporters, which is the right number for "picked this time" and
 * the wrong one for "have voted".
 */
function mapSlotsWithVotes(
  slots: SlotRow[],
  votes: ScheduleVoteRow[],
): ScheduleSlotWithVotesDto[] {
  return slots.map((slot) => {
    const onSlot = votes.filter((v) => v.slotId === slot.id);
    return {
      id: slot.id,
      matchId: slot.matchId,
      proposedTime: slot.proposedTime.toISOString(),
      overlapScore: slot.overlapScore ? Number(slot.overlapScore) : null,
      suggestedBy: slot.suggestedBy as 'system' | 'user',
      createdAt: slot.createdAt.toISOString(),
      votes: onSlot.filter((v) => (v.stance ?? 'yes') === 'yes').map(toVoter),
      noVotes: onSlot.filter((v) => v.stance === 'no').map(toVoter),
    };
  });
}

/**
 * Derive whether a lineup is a standalone scheduling poll (ROK-1300).
 *
 * Standalone lineups are created by the /events "Schedule a Game" flow and
 * carry `phaseDurationOverride.standalone === true` (same marker the events
 * banner excludes on — see `lineups-banner.helpers.ts::findBannerLineup`).
 * From-match lineups have a null override or no `standalone` key.
 */
export function deriveIsStandalone(phaseDurationOverride: unknown): boolean {
  if (
    phaseDurationOverride == null ||
    typeof phaseDurationOverride !== 'object'
  ) {
    return false;
  }
  return (
    (phaseDurationOverride as { standalone?: unknown }).standalone === true
  );
}

/**
 * Extract slot IDs the user answered with the given stance (ROK-1617).
 *
 * @param votes - Every vote row on the poll.
 * @param userId - The viewer, or null when anonymous.
 * @param stance - Which answer to collect.
 * @returns The viewer's slot ids holding that stance.
 */
function extractMySlotIds(
  votes: ScheduleVoteRow[],
  userId: number | null,
  stance: 'yes' | 'no',
): number[] {
  if (!userId) return [];
  return votes
    .filter((v) => v.userId === userId && (v.stance ?? 'yes') === stance)
    .map((v) => v.slotId);
}

/**
 * The poll page response MINUS the terminal-state fields (ROK-1545), which
 * need DB lookups (`resolvePollTerminalState`) this pure builder cannot do.
 */
export type PollResponseBase = Omit<
  SchedulePollPageResponseDto,
  | 'pollStatus'
  | 'lockedInTime'
  | 'cancelReason'
  | 'canVote'
  | 'canSuggest'
  | 'canLockIn'
  | 'lockInSlotId'
>;

/** Build the full poll page response (minus the terminal-state fields). */
export function buildPollResponse(
  match: MatchRow & {
    gameName?: string;
    gameCoverUrl?: string | null;
    lineupCreatedById?: number | null;
    playerCap?: number | null;
    followupForEventId?: number | null;
  },
  members: MatchMemberRow[],
  slots: SlotRow[],
  votes: ScheduleVoteRow[],
  userId: number | null,
  lineupStatus: string,
  isStandalone: boolean,
): PollResponseBase {
  const gameName = match.gameName ?? 'Unknown';
  const gameCoverUrl = match.gameCoverUrl ?? null;
  const lineupCreatedById = match.lineupCreatedById ?? null;
  const playerCap = match.playerCap ?? null;

  return {
    match: buildMatchDetailDto(
      match,
      members,
      gameName,
      gameCoverUrl,
      lineupCreatedById,
      playerCap,
      match.followupForEventId ?? null,
    ),
    slots: mapSlotsWithVotes(slots, votes),
    myVotedSlotIds: extractMySlotIds(votes, userId, 'yes'),
    myNoSlotIds: extractMySlotIds(votes, userId, 'no'),
    lineupStatus,
    isStandalone,
  };
}
