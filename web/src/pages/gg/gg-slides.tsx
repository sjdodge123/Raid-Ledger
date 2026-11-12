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
import { GgIntroBackground } from './gg-intro-background';

/** The #1 game of the year (id + stored screenshots), if the top-games card is present. */
export function topGameMedia(cards: readonly GgCardEnvelope[]): { gameId?: number; screenshots: readonly string[] } {
    const card = cards.find((c) => c.pluginSlug === 'core' && c.cardId === 'top-games');
    const parsed = GgTopGamesCardSchema.safeParse(card?.payload);
    const top = parsed.success ? parsed.data.games[0] : undefined;
    return top ? { gameId: top.gameId, screenshots: top.screenshots ?? [] } : { screenshots: [] };
}

/**
 * The default Ken Burns backdrops: the screenshots stored in the snapshot, else
 * (older snapshots) the top game's IGDB screenshots from the game detail.
 */
export function useGgBackdrops(media: { gameId?: number; screenshots: readonly string[] }): readonly string[] {
    const stored = media.screenshots.length > 0;
    const { data } = useGameDetail(stored ? undefined : media.gameId);
    return stored ? media.screenshots : data?.screenshots ?? [];
}

function backgroundFor(c: ResolvedGgCard, i: number, backdrops: readonly string[], started: boolean): JSX.Element {
    if (c.key === 'core:intro') return <GgIntroBackground started={started} />;
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
