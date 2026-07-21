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
    ...(lineupCreatedById !== null ? { lineupCreatedById } : {}),
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
      // ROK-1296: per-match scheduling submission timestamp.
      schedulingSubmittedAt: m.schedulingSubmittedAt?.toISOString() ?? null,
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
        avatar: v.avatar ?? null,
        discordId: v.discordId ?? null,
        customAvatarUrl: v.customAvatarUrl ?? null,
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
  match: MatchRow & {
    gameName?: string;
    gameCoverUrl?: string | null;
    lineupCreatedById?: number | null;
    playerCap?: number | null;
  },
  members: MatchMemberRow[],
  slots: SlotRow[],
  votes: ScheduleVoteRow[],
  userId: number | null,
  lineupStatus: string,
  isStandalone: boolean,
): SchedulePollPageResponseDto {
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
    ),
    slots: mapSlotsWithVotes(slots, votes),
    myVotedSlotIds: extractMyVotedSlotIds(votes, userId),
    lineupStatus,
    isStandalone,
  };
}
