import { Link } from 'react-router-dom';
import type { GameDetailDto } from '@raid-ledger/contract';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useAuth } from '../../hooks/use-auth';

/** IGDB genre ID → display name (common gaming genres) */
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
    36: 'MOBA',
};

/** IGDB game mode ID → display name */
const MODE_MAP: Record<number, string> = {
    1: 'Single',
    2: 'Multi',
    3: 'Co-op',
    4: 'Split screen',
    5: 'MMO',
};

interface GameCardProps {
    game: GameDetailDto;
    compact?: boolean;
}

export function GameCard({ game, compact = false }: GameCardProps) {
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? game.id : undefined,
    );

    const primaryGenre = game.genres[0] ? GENRE_MAP[game.genres[0]] : null;
    const primaryMode = game.gameModes[0] ? MODE_MAP[game.gameModes[0]] : null;
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
            className={`group block relative rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-900/20 ${compact ? 'w-[180px] flex-shrink-0' : ''
                }`}
        >
            {/* Cover Image */}
            <div className="relative aspect-[3/4] bg-overlay">
                {game.coverUrl ? (
                    <img
                        src={game.coverUrl}
                        alt={game.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-dim">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                )}

                {/* Rating badge */}
                {rating && rating > 0 && (
                    <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-md text-xs font-bold ${rating >= 75
                            ? 'bg-emerald-500/90 text-white'
                            : rating >= 50
                                ? 'bg-yellow-500/90 text-black'
                                : 'bg-red-500/90 text-white'
                        }`}>
                        {Math.round(rating)}
                    </div>
                )}

                {/* Bottom gradient overlay */}
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />

                {/* Game name overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">
                        {game.name}
                    </h3>
                    {primaryGenre && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-white/20 text-white/90 rounded">
                            {primaryGenre}
                        </span>
                    )}
                </div>

                {/* Want to play heart */}
                {isAuthenticated && (
                    <button
                        onClick={handleWantToPlay}
                        className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-1 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
                        aria-label={wantToPlay ? 'Remove from want to play' : 'Add to want to play'}
                    >
                        <svg
                            className={`w-4 h-4 transition-colors ${wantToPlay ? 'text-red-400 fill-red-400' : 'text-white/70'
                                }`}
                            fill={wantToPlay ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        {count > 0 && (
                            <span className="text-[10px] font-bold text-white/90 pr-0.5">{count}</span>
                        )}
                    </button>
                )}
            </div>

            {/* Info bar below image */}
            {!compact && (
                <div className="p-2.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted">
                        {rating && rating > 0 && (
                            <span className="flex items-center gap-0.5">
                                <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                                {Math.round(rating)}
                            </span>
                        )}
                        {primaryMode && (
                            <>
                                <span className="text-dim">·</span>
                                <span>{primaryMode}</span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </Link>
    );
}
