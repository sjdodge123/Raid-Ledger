/**
 * Determine whether the current user has performed the phase-specific action
 * on a lineup (ROK-1209). Drives persona resolution and pill visibility.
 */
import type {
    LineupDetailResponseDto,
    TiebreakerDetailDto,
} from '@raid-ledger/contract';

interface ActedUser {
    id: number;
}

function hasNomination(
    lineup: LineupDetailResponseDto,
    userId: number,
): boolean {
    return lineup.entries.some((e) => e.nominatedBy?.id === userId);
}

function hasVoted(lineup: LineupDetailResponseDto): boolean {
    return (lineup.myVotes ?? []).length > 0;
}

function hasBracketVote(tiebreaker: TiebreakerDetailDto | null): boolean {
    if (!tiebreaker || tiebreaker.mode !== 'bracket') return false;
    return (tiebreaker.matchups ?? []).some((m) => m.myVote != null);
}

function hasVeto(tiebreaker: TiebreakerDetailDto | null): boolean {
    if (!tiebreaker || tiebreaker.mode !== 'veto') return false;
    return tiebreaker.vetoStatus?.myVetoGameId != null;
}

export function hasUserActedInPhase(
    lineup: LineupDetailResponseDto,
    tiebreaker: TiebreakerDetailDto | null,
    user: ActedUser | null | undefined,
): boolean {
    if (!user) return false;
    if (lineup.status === 'archived') return false;
    if (hasBracketVote(tiebreaker) || hasVeto(tiebreaker)) return true;
    if (lineup.status === 'building') return hasNomination(lineup, user.id);
    if (lineup.status === 'voting') return hasVoted(lineup);
    if (lineup.status === 'decided') return hasVoted(lineup);
    return false;
}
