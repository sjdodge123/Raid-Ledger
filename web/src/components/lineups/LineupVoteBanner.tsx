/**
 * Banner shown on game detail pages when the game is on an active
 * Community Lineup. Lets users vote directly or navigate to the lineup.
 *
 * Operator review r3 2026-05-19: refactored to use the shared JourneyHero
 * component (with `noRibbon`) so the banner reads as a Cycle-4 hero on the
 * game detail page — same emerald border, tone tokens, badge + task layout,
 * and pill placement as the in-lineup hero. Per-status tone:
 *   - building  → action  (nominate-now CTA)
 *   - voting    → action  (vote-now CTA) / set (you've voted)
 *   - voting + tiebreaker active → set
 *   - decided   → set     (schedule-now CTA)
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLineupBanner } from '../../hooks/use-lineups';
import { useTiebreakerDetail } from '../../hooks/use-tiebreaker';
import { BannerHero } from './lineup-banner-hero';
import { TieOrVotingBanner } from './lineup-voting-banners';

interface Props {
    gameId: number;
}

export function LineupVoteBanner({ gameId }: Props): JSX.Element | null {
    const { data: banner } = useLineupBanner();
    if (!banner) return null;

    const entry = banner.entries.find((e) => e.gameId === gameId);
    if (!entry) return null;

    if (banner.status === 'building') {
        return (
            <NominatedBanner lineupId={banner.id} gameName={entry.gameName} />
        );
    }

    if (banner.status === 'voting') {
        if (banner.tiebreakerActive) {
            return (
                <TiebreakerOrVotingBanner
                    lineupId={banner.id}
                    gameId={gameId}
                    gameName={entry.gameName}
                />
            );
        }
        return (
            <TieOrVotingBanner
                lineupId={banner.id}
                gameId={gameId}
                gameName={entry.gameName}
            />
        );
    }

    if (banner.status === 'decided') {
        return (
            <DecidedBanner
                lineupId={banner.id}
                gameName={entry.gameName}
                schedulingEnabled={banner.includeSchedulingPhase !== false}
            />
        );
    }

    return null;
}

/**
 * Routes to the tiebreaker banner when this game is among the tied games,
 * else falls back to the regular voting banner. The lookup is lazy — we
 * only fetch tiebreaker detail when banner.tiebreakerActive is true.
 */
function TiebreakerOrVotingBanner({
    lineupId,
    gameId,
    gameName,
}: {
    lineupId: number;
    gameId: number;
    gameName: string;
}): JSX.Element {
    const { data: tiebreaker } = useTiebreakerDetail(lineupId);
    const isTiedGame = tiebreaker?.tiedGameIds?.includes(gameId) ?? false;
    if (tiebreaker && isTiedGame && tiebreaker.status === 'active') {
        return (
            <TiebreakerBanner
                lineupId={lineupId}
                gameName={gameName}
                mode={tiebreaker.mode}
                hasEngaged={hasEngaged(tiebreaker)}
            />
        );
    }
    return (
        <TieOrVotingBanner
            lineupId={lineupId}
            gameId={gameId}
            gameName={gameName}
        />
    );
}

/** Whether the current user has already engaged with the tiebreaker. */
function hasEngaged(
    tiebreaker: NonNullable<ReturnType<typeof useTiebreakerDetail>['data']>,
): boolean {
    if (tiebreaker.mode === 'veto') {
        return tiebreaker.vetoStatus?.myVetoGameId != null;
    }
    // Bracket: engaged when every active matchup has a myVote
    const matchups = tiebreaker.matchups ?? [];
    if (matchups.length === 0) return false;
    return matchups.every((m) => m.isCompleted || m.myVote != null);
}

function NominatedBanner({
    lineupId,
    gameName,
}: {
    lineupId: number;
    gameName: string;
}): JSX.Element {
    const navigate = useNavigate();
    return (
        <BannerHero
            phase="nominating"
            active={0}
            tone="action"
            badge="Community Lineup · Nominating"
            task={`${gameName} is nominated for the next group game.`}
            sub="View the lineup to see who else is nominated and add your own picks."
            secondaryLabel="View Lineup →"
            onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
        />
    );
}

function TiebreakerBanner({
    lineupId,
    gameName,
    mode,
    hasEngaged,
}: {
    lineupId: number;
    gameName: string;
    mode: 'bracket' | 'veto';
    hasEngaged: boolean;
}): JSX.Element {
    const navigate = useNavigate();
    const cta = mode === 'veto' ? 'Cast your veto' : 'Vote in bracket';
    const action = mode === 'veto' ? 'veto tiebreaker' : 'bracket tiebreaker';
    return (
        <BannerHero
            phase="voting"
            active={1}
            tone="set"
            badge="Community Lineup · Tiebreaker"
            task={`${gameName} is in a ${action}.`}
            sub={
                hasEngaged
                    ? "You've already cast your vote in this tiebreaker."
                    : `${cta} to break the tie.`
            }
            secondaryLabel={hasEngaged ? 'View Lineup →' : `${cta} →`}
            onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
        />
    );
}

function DecidedBanner({
    lineupId,
    gameName,
    schedulingEnabled,
}: {
    lineupId: number;
    gameName: string;
    schedulingEnabled: boolean;
}): JSX.Element {
    const navigate = useNavigate();
    // ROK-1302: terminal copy when the lineup opted out of the scheduling phase.
    return (
        <BannerHero
            phase="decided"
            active={2}
            tone="set"
            badge="Community Lineup · Decided"
            task={
                schedulingEnabled
                    ? `${gameName} matched — schedule a time to play.`
                    : `${gameName} won this lineup.`
            }
            sub={
                schedulingEnabled
                    ? 'View the lineup to lock in a time.'
                    : 'View the lineup for the full results.'
            }
            secondaryLabel="View Lineup →"
            onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
        />
    );
}
