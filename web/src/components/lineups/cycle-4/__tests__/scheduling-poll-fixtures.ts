/**
 * Shared fixtures for the SchedulingComposite specs (ROK-1300 → ROK-1545).
 *
 * Extracted from `SchedulingComposite.test.tsx` when ROK-1545's terminal-state
 * cases pushed that file past the 750-line test limit. One builder pair, so a
 * new field on the poll payload is added in ONE place.
 */
import type {
    SchedulePollPageResponseDto,
    MatchDetailResponseDto,
    ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';

/** The viewer's user id across the scheduling composite specs. */
export const ME = 99;

/** Build a single match-member row. */
export function buildMember(
    userId: number,
    schedulingSubmittedAt: string | null,
    displayName = `User ${userId}`,
    joinedAt = '2026-05-15T00:00:00.000Z',
): MatchDetailResponseDto['members'][number] {
    return {
        id: userId * 10,
        matchId: 500,
        userId,
        source: 'voted',
        createdAt: joinedAt,
        joinedAt,
        displayName,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        schedulingSubmittedAt,
    };
}

export interface PollOverrides {
    isStandalone?: boolean;
    /** lineup creator user id — drives operator/creator gating. */
    lineupCreatedById?: number;
    /** current viewer's schedulingSubmittedAt. */
    mySubmittedAt?: string | null;
    myVotedSlotIds?: number[];
    /** ROK-1617 — slots the viewer marked as NOT working for them. */
    myNoSlotIds?: number[];
    /** ROK-1617 — how many anti-voters each slot id carries. */
    noVotersBySlot?: Record<number, number>;
    /** ROK-1545 — the server-derived poll lifecycle. */
    pollStatus?: 'open' | 'locked_in' | 'cancelled' | 'closed';
    /** ROK-1545 — whether the viewer may cast a vote at all. */
    canVote?: boolean;
    /** Review fix — whether the viewer may still SUGGEST a time. */
    canSuggest?: boolean;
    lockedInTime?: string | null;
    cancelReason?: string | null;
    /** ROK-1610 — the organiser may finish this expired poll. */
    canLockIn?: boolean;
    /** ROK-1610 — the future, voted slot such a lock-in would pick. */
    lockInSlotId?: number | null;
    /** Replace the default two-member roster (late-joiner cases). */
    members?: MatchDetailResponseDto['members'];
}

/**
 * ROK-1617: the anti-voters on one slot. The viewer is always first when the
 * slot is in `myNoSlotIds`, so a spec can assert both the count and the
 * viewer's own pressed state from one override pair.
 */
function buildNoVoters(
    slotId: number,
    counts: Record<number, number>,
    mine: number[],
): ScheduleSlotWithVotesDto['noVotes'] {
    const total = counts[slotId] ?? (mine.includes(slotId) ? 1 : 0);
    return Array.from({ length: total }, (_, i) => {
        const mineFirst = mine.includes(slotId) && i === 0;
        return {
            userId: mineFirst ? ME : 500 + i,
            displayName: mineFirst ? 'Me' : `No ${i}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        };
    });
}

export function buildPoll(overrides: PollOverrides = {}): SchedulePollPageResponseDto {
    const {
        isStandalone = false,
        lineupCreatedById = 1,
        mySubmittedAt = null,
        myVotedSlotIds = [],
        myNoSlotIds = [],
        noVotersBySlot = {},
        pollStatus = 'open',
        canVote = pollStatus === 'open',
        canSuggest = canVote,
        lockedInTime = null,
        cancelReason = null,
        canLockIn = false,
        lockInSlotId = null,
        members = [buildMember(ME, mySubmittedAt), buildMember(2, null)],
    } = overrides;

    const match: MatchDetailResponseDto = {
        id: 500,
        lineupId: 7,
        gameId: 42,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 3,
        votePercentage: 60,
        fitType: 'normal',
        linkedEventId: null,
        minVoteThreshold: 2,
        playerCap: null,
        thresholdNotifiedAt: null,
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
        gameName: 'Valheim',
        gameCoverUrl: null,
        lineupCreatedById,
        members,
    };

    const poll = {
        match,
        slots: [
            {
                id: 1001,
                matchId: 500,
                proposedTime: '2030-06-10T20:00:00.000Z',
                overlapScore: 0.8,
                suggestedBy: 'system',
                createdAt: '2026-05-16T00:00:00.000Z',
                votes: [
                    {
                        userId: ME,
                        displayName: 'Me',
                        avatar: null,
                        discordId: null,
                        customAvatarUrl: null,
                    },
                ],
                noVotes: buildNoVoters(1001, noVotersBySlot, myNoSlotIds),
            },
            {
                id: 1002,
                matchId: 500,
                proposedTime: '2030-06-11T20:00:00.000Z',
                overlapScore: 0.5,
                suggestedBy: 'user',
                createdAt: '2026-05-16T00:00:00.000Z',
                votes: [],
                noVotes: buildNoVoters(1002, noVotersBySlot, myNoSlotIds),
            },
        ],
        myVotedSlotIds,
        myNoSlotIds,
        lineupStatus: 'scheduling',
        uniqueVoterCount: 2,
        slotConflicts: [],
        phaseDeadline: null,
        // ROK-1300 NEW field — cast in case the contract type hasn't been
        // rebuilt with `isStandalone` yet. The test must fail because the
        // COMPONENT is missing, not because the type is.
        isStandalone,
        pollStatus,
        canVote,
        canSuggest,
        lockedInTime,
        cancelReason,
        canLockIn,
        lockInSlotId,
    } as SchedulePollPageResponseDto;

    return poll;
}

