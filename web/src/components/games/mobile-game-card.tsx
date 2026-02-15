import type React from 'react';
import { Link } from 'react-router-dom';
import type { GameDetailDto } from '@raid-ledger/contract';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';

/** IGDB genre ID → display name (subset for mobile badge) */
const GENRE_MAP: Record<number, string> = {
    2: 'Point-and-click',
    4: 'Fighting',
    5: 'Shooter',
    7: 'Music',
    8: 'Platform',
    9: 'Puzzle',
    10: 'Racing',
    11: 'RTS',
    12: 'RPG',
    13: 'Simulator',
    14: 'Sport',
    15: 'Strategy',
    16: 'TBS',
    24: 'Tactical',
    25: 'Hack and slash',
    26: 'Quiz',
    30: 'Pinball',
    31: 'Adventure',
    32: 'Indie',
    33: 'Arcade',
    34: 'Visual Novel',
    35: 'Card Game',
    36: 'MMORPG',
};

interface MobileGameCardProps {
    game: GameDetailDto;
}

/**
 * Mobile-optimized game card — vertical layout for 2-column grid.
 * Renders below md breakpoint; desktop GameCard handles ≥md.
 */
export function MobileGameCard({ game }: MobileGameCardProps) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );

    const primaryGenre = game.genres[0] ? GENRE_MAP[game.genres[0]] : null;
    const rating = game.aggregatedRating ?? game.rating;

    const handleWantToPlay = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isToggling && isAuthenticated) {
            toggle(!wantToPlay);
        }
    };

    return (
        <Link
            to={`/games/${game.id}`}
            data-testid="mobile-game-card"
            className="group block relative rounded-lg overflow-hidden bg-surface border border-edge hover:border-dim transition-all"
        >
            {/* Cover Image */}
            <div className="relative aspect-[3/4] bg-panel">
                {game.coverUrl ? (
                    <img
                        src={game.coverUrl}
                        alt={game.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Rating badge (top right) */}
                {rating && rating > 0 && (
                    <div
                        data-testid="mobile-game-rating"
                        className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-xs font-bold ${rating >= 75
                            ? 'bg-emerald-500/90 text-white'
                            : rating >= 50
                                ? 'bg-yellow-500/90 text-black'
                                : 'bg-red-500/90 text-white'
                            }`}
                    >
                        {Math.round(rating)}
                    </div>
                )}

                {/* Heart button (≥44px tap target) */}
                {isAuthenticated && (
                    <button
                        onClick={handleWantToPlay}
                        data-testid="mobile-game-heart"
                        className="absolute top-1 left-1 flex items-center justify-center w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
                        aria-label={wantToPlay ? 'Remove from want to play' : 'Add to want to play'}
                    >
                        <svg
                            className={`w-5 h-5 transition-colors ${wantToPlay ? 'text-red-400 fill-red-400' : 'text-white/70'
                                }`}
                            fill={wantToPlay ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                            />
                        </svg>
                        {count > 0 && (
                            <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-white/90 bg-black/70 rounded-full px-1.5 py-0.5">
                                {count}
                            </span>
                        )}
                    </button>
                )}

                {/* Bottom gradient overlay with game name + genre */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
                    <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                        {game.name}
                    </h3>
                    {primaryGenre && (
                        <span data-testid="mobile-game-genre" className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">
                            {primaryGenre}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
}
