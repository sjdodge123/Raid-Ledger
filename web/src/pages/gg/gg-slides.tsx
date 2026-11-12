/**
 * Turns resolved GG cards into StoryViewer slides (ROK-2187): the card body
 * in a Suspense boundary, and its backdrop — the card's own image, else one of
 * the top game's IGDB screenshots, as a Ken Burns still (reduced motion =
 * static). The intro's backdrop flips from neutral to accent once started.
 */
import { Suspense, type JSX } from 'react';
import { GgTopGamesCardSchema, type GgCardEnvelope } from '@raid-ledger/contract';
import { KenBurnsBackground, type StorySlide } from '../../components/ui/story-viewer';
import type { ResolvedGgCard } from '../../plugins/gg-cards';
import { useGameDetail } from '../../hooks/use-games-discover';

/** The #1 game id of the year, if the top-games card is present. */
export function topGameId(cards: readonly GgCardEnvelope[]): number | undefined {
    const card = cards.find((c) => c.pluginSlug === 'core' && c.cardId === 'top-games');
    const parsed = GgTopGamesCardSchema.safeParse(card?.payload);
    return parsed.success ? parsed.data.games[0]?.gameId : undefined;
}

/** IGDB screenshots of the top game — the default Ken Burns backdrops. */
export function useGgBackdrops(gameId: number | undefined): readonly string[] {
    const { data } = useGameDetail(gameId);
    return data?.screenshots ?? [];
}

function IntroBackground({ started }: { started: boolean }): JSX.Element {
    const tint = started ? 'from-success/30 via-surface to-backdrop' : 'from-panel via-surface to-backdrop';
    return <div aria-hidden="true" data-testid="gg-intro-bg" className={`absolute inset-0 bg-gradient-to-b transition-colors duration-1000 motion-reduce:transition-none ${tint}`} />;
}

function backgroundFor(c: ResolvedGgCard, i: number, backdrops: readonly string[], started: boolean): JSX.Element {
    if (c.key === 'core:intro') return <IntroBackground started={started} />;
    const own = c.card.backgroundSrc?.(c.payload);
    const fallback = backdrops.length > 0 ? backdrops[i % backdrops.length] : undefined;
    return <KenBurnsBackground src={own ?? fallback} />;
}

/** One slide per resolved card. */
export function buildGgSlides(cards: readonly ResolvedGgCard[], year: number, backdrops: readonly string[], started: boolean): StorySlide[] {
    return cards.map((c, i) => {
        const { Component } = c.card;
        const slide: StorySlide = {
            id: c.key,
            label: c.key === 'core:intro' ? `GG ${year}` : c.card.label,
            content: () => <Suspense fallback={null}><Component payload={c.payload} year={year} /></Suspense>,
            background: backgroundFor(c, i, backdrops, started),
        };
        return c.card.durationMs === undefined ? slide : { ...slide, durationMs: c.card.durationMs };
    });
}
