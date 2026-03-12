import { useRef, useState, useEffect } from 'react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from './unified-game-card';

interface GameCarouselProps {
    category: string;
    games: GameDetailDto[];
    /** Batch pricing map from parent. */
    pricingMap?: Map<number, ItadGamePricingDto | null>;
}

const ARROW_CLS = 'absolute top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-surface/90 border border-edge rounded-full flex items-center justify-center text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-panel';

function ScrollArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
    const path = direction === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7';
    return (
        <button onClick={onClick} className={`${ARROW_CLS} ${direction === 'left' ? 'left-0' : 'right-0'}`} aria-label={`Scroll ${direction}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
            </svg>
        </button>
    );
}

function useCarouselScroll(games: GameDetailDto[]) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const checkScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 0);
        setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    useEffect(() => {
        checkScroll();
        const el = scrollRef.current;
        if (el) { el.addEventListener('scroll', checkScroll, { passive: true }); return () => el.removeEventListener('scroll', checkScroll); }
    }, [games]);

    const scroll = (direction: 'left' | 'right') => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ left: direction === 'left' ? -el.clientWidth * 0.8 : el.clientWidth * 0.8, behavior: 'smooth' });
    };

    return { scrollRef, canScrollLeft, canScrollRight, scroll };
}

export function GameCarousel({ category, games, pricingMap }: GameCarouselProps) {
    const { scrollRef, canScrollLeft, canScrollRight, scroll } = useCarouselScroll(games);
    if (games.length === 0) return null;

    return (
        <div className="relative group/carousel">
            <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-semibold text-foreground">{category}</h2></div>
            <div className="relative">
                {canScrollLeft && <ScrollArrow direction="left" onClick={() => scroll('left')} />}
                <div ref={scrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {games.map((game) => <div key={game.id} className="snap-start"><UnifiedGameCard variant="link" game={game} compact showRating showInfoBar pricing={pricingMap?.get(game.id) ?? null} /></div>)}
                </div>
                {canScrollRight && <ScrollArrow direction="right" onClick={() => scroll('right')} />}
            </div>
        </div>
    );
}
