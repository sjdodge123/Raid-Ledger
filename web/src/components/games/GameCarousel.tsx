import { useRef, useState, useEffect } from 'react';
import type { GameDetailDto } from '@raid-ledger/contract';
import { GameCard } from './GameCard';

interface GameCarouselProps {
    category: string;
    games: GameDetailDto[];
}

export function GameCarousel({ category, games }: GameCarouselProps) {
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
        if (el) {
            el.addEventListener('scroll', checkScroll, { passive: true });
            return () => el.removeEventListener('scroll', checkScroll);
        }
    }, [games]);

    const scroll = (direction: 'left' | 'right') => {
        const el = scrollRef.current;
        if (!el) return;
        const scrollAmount = el.clientWidth * 0.8;
        el.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth',
        });
    };

    if (games.length === 0) return null;

    return (
        <div className="relative group/carousel">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-foreground">{category}</h2>
            </div>

            {/* Scroll container */}
            <div className="relative">
                {/* Left arrow */}
                {canScrollLeft && (
                    <button
                        onClick={() => scroll('left')}
                        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-surface/90 border border-edge rounded-full flex items-center justify-center text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-panel"
                        aria-label="Scroll left"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                )}

                {/* Cards */}
                <div
                    ref={scrollRef}
                    className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                >
                    {games.map((game) => (
                        <div key={game.id} className="snap-start">
                            <GameCard game={game} compact />
                        </div>
                    ))}
                </div>

                {/* Right arrow */}
                {canScrollRight && (
                    <button
                        onClick={() => scroll('right')}
                        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-surface/90 border border-edge rounded-full flex items-center justify-center text-foreground shadow-lg opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-panel"
                        aria-label="Scroll right"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}
