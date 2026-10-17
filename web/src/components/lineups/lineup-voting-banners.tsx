/**
 * The voting-phase banners of the Games page: the ROK-1374 tie hold and the
 * plain vote CTA (extracted from LineupVoteBanner.tsx for the 300-line cap).
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TieReadinessResponseDto } from '@raid-ledger/contract';
import { useLineupDetail, useToggleVote } from '../../hooks/use-lineups';
import { useTieReadiness } from '../../hooks/use-tie-readiness';
import { toast } from '../../lib/toast';
import { BannerHero } from './lineup-banner-hero';

/**
 * Pre-pick tie state (ROK-1374 / AC13).
 *
 * A vote that closed on a tie is parked on a tie hold, and by D2 no tiebreaker
 * row exists — so this game would otherwise fall through to the plain "vote
 * now" banner, which is a lie: voting is over and the group is waiting on one
 * person. Named waiting converts the dead end into a nudge.
 */
export function TieOrVotingBanner({
    lineupId,
    gameId,
    gameName,
}: {
    lineupId: number;
    gameId: number;
    gameName: string;
}): JSX.Element {
    const navigate = useNavigate();
    const { data: tie } = useTieReadiness(lineupId);
    // ROK-1374: the vote is closed for the WHOLE hold, on every nominee — a
    // pick does not reopen it, and a game outside the tie has lost. Falling
    // through to the live Vote button here is how a vote used to dissolve the
    // tie underneath the card (operator test, 2026-09-05).
    const holdOpen =
        tie?.status === 'awaiting_pick' || tie?.status === 'picked';
    if (tie && holdOpen) {
        const copy = tieHoldCopy(tie, gameId, gameName);
        return (
            <BannerHero
                phase="voting"
                active={1}
                tone="waiting"
                badge="Community Lineup · Tied"
                task={copy.task}
                sub={copy.sub}
                secondaryLabel="Compare them →"
                onSecondaryClick={() =>
                    navigate(`/community-lineup/${lineupId}`)
                }
            />
        );
    }
    return (
        <VotingBanner lineupId={lineupId} gameId={gameId} gameName={gameName} />
    );
}

/** Which game the viewer is on changes the sub-line, never the task. */
function tieHoldCopy(
    tie: TieReadinessResponseDto,
    gameId: number,
    gameName: string,
): { task: string; sub: string } {
    const picker = tie.pickerName ?? 'the lineup creator';
    const task = tie.pick
        ? `Tied — ${tie.pick.byUsername} picked; locking in`
        : `Tied — waiting on ${picker} to pick`;
    const tiedHere = tie.games.some((g) => g.gameId === gameId);
    const sub = tiedHere
        ? `${gameName} tied on votes. Compare what everyone already owns on the lineup page.`
        : 'Voting closed on a tie between other games. Compare them on the lineup page.';
    return { task, sub };
}

function VotingBanner({
    lineupId,
    gameId,
    gameName,
}: {
    lineupId: number;
    gameId: number;
    gameName: string;
}): JSX.Element {
    const { data: detail } = useLineupDetail(lineupId);
    const voteMutation = useToggleVote();
    const navigate = useNavigate();
    const hasVoted = detail?.myVotes?.includes(gameId) ?? false;
    const isVoting = voteMutation.isPending;

    const handleVote = (): void => {
        voteMutation.mutate(
            { lineupId, gameId },
            {
                onSuccess: (data) => {
                    const stillVoted = data.myVotes?.includes(gameId) ?? false;
                    toast.success(
                        stillVoted ? 'Vote recorded' : 'Vote removed',
                    );
                },
                onError: (err) =>
                    toast.error(
                        err instanceof Error ? err.message : 'Vote failed',
                    ),
            },
        );
    };

    return (
        <BannerHero
            phase="voting"
            active={1}
            tone={hasVoted ? 'set' : 'action'}
            badge="Community Lineup · Voting"
            task={`${gameName} is up for a vote!`}
            sub={
                hasVoted
                    ? "You've voted for this game."
                    : 'Cast your vote or view the lineup.'
            }
            primaryLabel={isVoting ? 'Saving…' : hasVoted ? '✓ Voted' : 'Vote'}
            primaryDisabled={isVoting}
            onPrimaryClick={handleVote}
            secondaryLabel="View Lineup →"
            onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
        />
    );
}
