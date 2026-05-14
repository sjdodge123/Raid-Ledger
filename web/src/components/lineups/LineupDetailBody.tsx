/**
 * Phase-aware body switch for the lineup detail page. Renders the read-only
 * aborted snapshot first (ROK-1207), then the tiebreaker / decided / voting /
 * building branches that ROK-1253 wired up. Refs are forwarded from the
 * parent so the hero CTAs (`scrollIntoView`) still target the live DOM.
 */
import type { Ref, JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { NominationGrid } from './NominationGrid';
import { VotingLeaderboard } from './VotingLeaderboard';
import { LineupEmptyState } from './LineupEmptyState';
import { DecidedView } from './decided/DecidedView';
import { TiebreakerView } from './tiebreaker/TiebreakerView';
import { TiebreakerClosedNotice } from './tiebreaker/TiebreakerClosedNotice';
import { AbortedReadOnlySnapshot } from './AbortedReadOnlySnapshot';
import type { useTiebreakerDetail } from '../../hooks/use-tiebreaker';

type Tiebreaker = ReturnType<typeof useTiebreakerDetail>['data'] | null | undefined;

interface Props {
    lineup: LineupDetailResponseDto;
    tiebreaker: Tiebreaker;
    isAborted: boolean;
    canParticipate: boolean;
    leaderboardRef: Ref<HTMLElement>;
    bracketRef: Ref<HTMLElement>;
}

export function LineupDetailBody(props: Props): JSX.Element {
    const { lineup, tiebreaker, isAborted, canParticipate, leaderboardRef, bracketRef } = props;
    const hasEntries = lineup.entries.length > 0;
    const hasTiebreaker =
        !!tiebreaker &&
        lineup.status === 'voting' &&
        ['active', 'pending', 'resolved'].includes(tiebreaker.status);
    const showDecidedTiebreakerNotice =
        !!tiebreaker &&
        lineup.status === 'decided' &&
        tiebreaker.status === 'resolved';

    if (isAborted) return <AbortedReadOnlySnapshot lineup={lineup} />;

    if (hasTiebreaker && (tiebreaker?.status === 'active' || tiebreaker?.status === 'resolved')) {
        return (
            <section ref={bracketRef as Ref<HTMLElement>}>
                <TiebreakerView tiebreaker={tiebreaker} lineupId={lineup.id} />
            </section>
        );
    }

    if (lineup.status === 'decided') {
        return (
            <>
                {showDecidedTiebreakerNotice && tiebreaker && (
                    <TiebreakerClosedNotice
                        title={tiebreaker.mode === 'veto' ? 'Veto Elimination' : 'Bracket Tiebreaker'}
                        resolvedAt={tiebreaker.resolvedAt}
                    />
                )}
                <DecidedView lineup={lineup} />
            </>
        );
    }

    if (lineup.status === 'voting' && hasEntries) {
        return (
            <section ref={leaderboardRef as Ref<HTMLElement>}>
                <VotingLeaderboard
                    entries={lineup.entries}
                    lineupId={lineup.id}
                    myVotes={lineup.myVotes ?? []}
                    totalVoters={lineup.totalVoters}
                    totalMembers={lineup.totalMembers}
                    maxVotesPerPlayer={lineup.maxVotesPerPlayer}
                    canParticipate={canParticipate}
                />
            </section>
        );
    }

    if (hasEntries) {
        return <NominationGrid entries={lineup.entries} lineupId={lineup.id} />;
    }

    return <LineupEmptyState />;
}

