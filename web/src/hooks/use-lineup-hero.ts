/**
 * useLineupHero — composes persona + phase-state + copy registry, then wires
 * CTA `onClick` per copy variant (ROK-1209). Returns props ready for
 * `<HeroNextStep>`.
 */
import { useCallback, useMemo, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
    LineupDetailResponseDto,
    TiebreakerDetailDto,
} from '@raid-ledger/contract';
import { useAuth } from './use-auth';
import { useForceResolve } from './use-tiebreaker';
import { getLineupPersona } from '../lib/lineup-persona';
import { hasUserActedInPhase } from '../lib/lineup-acted';
import { useLineupAbortedAt } from '../lib/lineup-aborted';
import { getPhaseState } from '../lib/lineup-phase-state';
import {
    getLineupHeroCopy,
    type HeroCopy,
    type PageId,
} from '../lib/lineup-hero-copy';
import type { HeroNextStepProps } from '../components/common/HeroNextStep';

export interface LineupHeroScrollTargets {
    leaderboard: RefObject<HTMLElement | null>;
    slotGrid: RefObject<HTMLElement | null>;
    bracket: RefObject<HTMLElement | null>;
}

export interface UseLineupHeroOptions {
    lineup: LineupDetailResponseDto;
    tiebreaker: TiebreakerDetailDto | null;
    scrollTargets: LineupHeroScrollTargets;
    onOpenNominate?: () => void;
    pageId?: PageId;
}

function pageIdForLineup(lineup: LineupDetailResponseDto): PageId {
    if (lineup.status === 'building') return 'building';
    if (lineup.status === 'voting') return 'voting';
    if (lineup.status === 'decided') return 'decided';
    return 'lineup-detail';
}

function nominatedGameNamesFor(
    lineup: LineupDetailResponseDto,
    userId: number | undefined,
): string[] {
    if (userId == null) return [];
    return lineup.entries
        .filter((e) => e.nominatedBy?.id === userId)
        .map((e) => e.gameName);
}

function myMatchCountFor(
    lineup: LineupDetailResponseDto,
    userId: number | undefined,
): number {
    if (userId == null || lineup.decidedGameId == null) return 0;
    return (lineup.myVotes ?? []).includes(lineup.decidedGameId) ? 1 : 0;
}

function scrollTo(ref: RefObject<HTMLElement | null>): void {
    if (ref.current) {
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

export function useLineupHero(
    opts: UseLineupHeroOptions,
): HeroNextStepProps {
    const { lineup, tiebreaker, scrollTargets, onOpenNominate, pageId } = opts;
    const { user } = useAuth();
    const navigate = useNavigate();
    const { abortedAt } = useLineupAbortedAt(lineup.id);
    const forceResolve = useForceResolve();

    const acted = useMemo(
        () => hasUserActedInPhase(lineup, tiebreaker, user),
        [lineup, tiebreaker, user],
    );
    const persona = useMemo(
        () => getLineupPersona(lineup, user, acted),
        [lineup, user, acted],
    );
    const phaseState = useMemo(
        () => getPhaseState(lineup, abortedAt),
        [lineup, abortedAt],
    );

    const copy: HeroCopy = useMemo(() => {
        const usingPage =
            pageId ?? (tiebreaker?.status === 'active' ? 'tiebreaker' : pageIdForLineup(lineup));
        return getLineupHeroCopy({
            pageId: usingPage,
            persona,
            phaseState,
            lineup,
            tiebreaker,
            myNominatedGameNames: nominatedGameNamesFor(lineup, user?.id),
            myMatchCount: myMatchCountFor(lineup, user?.id),
            myVotedSlotCount: 0,
        });
    }, [pageId, lineup, tiebreaker, persona, phaseState, user?.id]);

    const wireCta = useCallback((): (() => void) | undefined => {
        const text = copy.cta?.text ?? '';
        if (copy.tone === 'aborted') return () => navigate('/games');
        if (/^nominate a game/i.test(text)) return onOpenNominate;
        if (/^open voting/i.test(text)) return () => scrollTo(scrollTargets.leaderboard);
        if (/^pick a slot/i.test(text)) return () => scrollTo(scrollTargets.slotGrid);
        if (/^vote in bracket|^finish bracket/i.test(text)) {
            return () => scrollTo(scrollTargets.bracket);
        }
        if (/^schedule /i.test(text) && lineup.decidedGameId != null) {
            return () => navigate(
                `/community-lineup/${lineup.id}/schedule/${lineup.decidedGameId}`,
            );
        }
        if (/^force.?resolve/i.test(text)) return () => forceResolve.mutate(lineup.id);
        if (/^advance to/i.test(text)) return undefined;
        return undefined;
    }, [copy, lineup.id, lineup.decidedGameId, navigate, onOpenNominate, scrollTargets, forceResolve]);

    const heroProps = useMemo<HeroNextStepProps>(() => {
        const onClick = wireCta();
        return {
            tone: copy.tone,
            label: copy.label,
            headline: copy.headline,
            detail: copy.detail,
            cta: copy.cta
                ? {
                    text: copy.cta.text,
                    ariaLabel: copy.cta.ariaLabel,
                    disabled: copy.cta.disabled,
                    tooltip: copy.cta.tooltip,
                    onClick: onClick ?? (() => undefined),
                }
                : undefined,
            secondary: copy.secondary,
        };
    }, [copy, wireCta]);

    return heroProps;
}
