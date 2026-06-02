import type { JSX } from 'react';
import { useState, useCallback } from 'react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { GameResearchDrawer } from './GameResearchDrawer';
import { GENRE_MAP } from '../../lib/game-utils';
import {
    CoverImage,
    CoverPlaceholder,
    RatingBadge,
    GradientOverlay,
    CardTitle,
    GenreBadge,
} from './game-card-parts';
import { PriceBadge } from './PriceBadge';

/**
 * ROK-1295 demo integration card for the `/games` index carousel.
 * Replaces the Link-based UnifiedGameCard with a button that opens the
 * universal GameResearchDrawer in-place (no navigation).
 *
 * Carries the `game-ref-row` testid expected by the Playwright spec.
 */
interface DrawerCardProps {
    game: GameDetailDto;
    pricing: ItadGamePricingDto | null;
}

function CoverContent({
    game,
    rating,
}: {
    game: GameDetailDto;
    rating: number | null;
}): JSX.Element {
    const primaryGenre = game.genres?.[0] != null ? GENRE_MAP[game.genres[0]] ?? null : null;
    return (
        <div className="relative aspect-[3/4] bg-panel">
            {game.coverUrl ? <CoverImage src={game.coverUrl} alt={game.name} /> : <CoverPlaceholder />}
            {rating != null && <RatingBadge rating={rating} />}
            <GradientOverlay />
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <CardTitle name={game.name} />
                {primaryGenre && (
                    <div className="flex items-center gap-1.5 mt-1">
                        <GenreBadge label={primaryGenre} />
                    </div>
                )}
            </div>
        </div>
    );
}

export function DrawerCard({ game, pricing }: DrawerCardProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const rating = game.aggregatedRating ?? game.rating ?? null;
    return (
        <>
            <button
                type="button"
                data-testid="game-ref-row"
                onClick={open}
                className="group block relative rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/20 transition-all w-full text-left"
                aria-label={`Research ${game.name}`}
            >
                <CoverContent game={game} rating={rating && rating > 0 ? rating : null} />
                {pricing && (
                    <div className="absolute bottom-2 right-2">
                        <PriceBadge pricing={pricing} />
                    </div>
                )}
            </button>
            <GameResearchDrawer
                isOpen={isOpen}
                onClose={close}
                gameId={game.id}
            />
        </>
    );
}
