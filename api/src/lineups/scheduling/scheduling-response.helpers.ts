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
  createdAt: Date;
  updatedAt: Date;
};

/** Map a match row + members to a MatchDetailResponseDto. */
export function buildMatchDetailDto(
  match: MatchRow,
  members: MatchMemberRow[],
  gameName: string,
  gameCoverUrl: string | null,
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
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
    gameName,
    gameCoverUrl,
    members: members.map((m) => ({
      id: m.id,
      matchId: m.matchId,
      userId: m.userId,
      source: m.source as 'voted' | 'bandwagon',
      createdAt: m.createdAt.toISOString(),
      displayName: m.displayName,
      avatar: m.avatar,
      discordId: m.discordId,
      customAvatarUrl: m.customAvatarUrl,
    })),
  };
}

/** Map slot rows + votes into enriched slot DTOs. */
function mapSlotsWithVotes(
  slots: SlotRow[],
  votes: ScheduleVoteRow[],
): ScheduleSlotWithVotesDto[] {
  return slots.map((slot) => {
    const slotVotes = votes
      .filter((v) => v.slotId === slot.id)
      .map((v) => ({
        userId: v.userId,
        displayName: v.displayName,
      }));
    return {
      id: slot.id,
      matchId: slot.matchId,
      proposedTime: slot.proposedTime.toISOString(),
      overlapScore: slot.overlapScore ? Number(slot.overlapScore) : null,
      suggestedBy: slot.suggestedBy as 'system' | 'user',
      createdAt: slot.createdAt.toISOString(),
      votes: slotVotes,
    };
  });
}

/** Extract slot IDs the user has voted on. */
function extractMyVotedSlotIds(
  votes: ScheduleVoteRow[],
  userId: number | null,
): number[] {
  if (!userId) return [];
  return votes.filter((v) => v.userId === userId).map((v) => v.slotId);
}

/** Build the full poll page response. */
export function buildPollResponse(
  match: MatchRow & { gameName?: string; gameCoverUrl?: string | null },
  members: MatchMemberRow[],
  slots: SlotRow[],
  votes: ScheduleVoteRow[],
  userId: number | null,
  lineupStatus: string,
): SchedulePollPageResponseDto {
  const gameName = (match as { gameName?: string }).gameName ?? 'Unknown';
  const gameCoverUrl =
    (match as { gameCoverUrl?: string | null }).gameCoverUrl ?? null;

  return {
    match: buildMatchDetailDto(match, members, gameName, gameCoverUrl),
    slots: mapSlotsWithVotes(slots, votes),
    myVotedSlotIds: extractMyVotedSlotIds(votes, userId),
    lineupStatus,
  };
}
