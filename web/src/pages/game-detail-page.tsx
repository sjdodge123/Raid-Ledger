import { useParams, Link } from 'react-router-dom';
import { useGameDetail, useGameStreams } from '../hooks/use-games-discover';
import { useWantToPlay } from '../hooks/use-want-to-play';
import { useAuth } from '../hooks/use-auth';
import { ScreenshotGallery } from '../components/games/ScreenshotGallery';
import { TwitchStreamEmbed } from '../components/games/TwitchStreamEmbed';

/** IGDB genre ID → display name */
const GENRE_MAP: Record<number, string> = {
    2: 'Point-and-click', 4: 'Fighting', 5: 'Shooter', 7: 'Music',
    8: 'Platform', 9: 'Puzzle', 10: 'Racing', 11: 'RTS', 12: 'RPG',
    13: 'Simulator', 14: 'Sport', 15: 'Strategy', 16: 'TBS',
    24: 'Tactical', 25: 'Hack and slash', 26: 'Quiz', 30: 'Pinball',
    31: 'Adventure', 32: 'Indie', 33: 'Arcade', 34: 'Visual Novel',
    35: 'Card Game', 36: 'MOBA',
};

/** IGDB platform ID → display name (common ones) */
const PLATFORM_MAP: Record<number, string> = {
    6: 'PC', 48: 'PS4', 167: 'PS5', 49: 'Xbox One',
    169: 'Xbox Series', 130: 'Switch', 34: 'Android', 39: 'iOS',
    170: 'Stadia', 14: 'Mac', 3: 'Linux',
};

/** IGDB game mode ID → display name */
const MODE_MAP: Record<number, string> = {
    1: 'Single Player', 2: 'Multiplayer', 3: 'Co-op',
    4: 'Split Screen', 5: 'MMO',
};

export function GameDetailPage() {
    const { id } = useParams<{ id: string }>();
    const gameId = id ? parseInt(id, 10) : undefined;

    const { data: game, isLoading, error } = useGameDetail(gameId);
    const { data: streamsData } = useGameStreams(gameId);
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? gameId : undefined,
    );

    if (isLoading) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse">
                <div className="h-64 bg-overlay rounded-xl mb-8" />
                <div className="h-8 bg-overlay rounded w-1/3 mb-4" />
                <div className="h-4 bg-overlay rounded w-2/3 mb-2" />
                <div className="h-4 bg-overlay rounded w-1/2" />
            </div>
        );
    }

    if (error || !game) {
        return (
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-red-400">Game Not Found</h2>
                    <p className="text-muted mt-2">This game could not be found.</p>
                    <Link to="/games" className="mt-4 inline-block text-emerald-400 hover:text-emerald-300">
                        ← Back to Games
                    </Link>
                </div>
            </div>
        );
    }

    const rating = game.aggregatedRating ?? game.rating;
    const genres = game.genres.map((id) => GENRE_MAP[id]).filter(Boolean);
    const platforms = game.platforms.map((id) => PLATFORM_MAP[id]).filter(Boolean);
    const modes = game.gameModes.map((id) => MODE_MAP[id]).filter(Boolean);

    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            {/* Back link */}
            <Link
                to="/games"
                className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors mb-6"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Games
            </Link>

            {/* Banner */}
            <div className="relative rounded-xl overflow-hidden mb-8">
                {/* Blurred background */}
                <div className="absolute inset-0">
                    {game.coverUrl && (
                        <img
                            src={game.coverUrl}
                            alt=""
                            className="w-full h-full object-cover blur-2xl scale-110 opacity-30"
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-b from-backdrop/50 to-backdrop" />
                </div>

                {/* Content */}
                <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row gap-6">
                    {/* Cover art */}
                    {game.coverUrl && (
                        <img
                            src={game.coverUrl}
                            alt={game.name}
                            className="w-40 sm:w-48 aspect-[3/4] object-cover rounded-xl shadow-2xl flex-shrink-0"
                        />
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
                            {game.name}
                        </h1>

                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                            {rating && rating > 0 && (
                                <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${rating >= 75
                                        ? 'bg-emerald-500/20 text-emerald-400'
                                        : rating >= 50
                                            ? 'bg-yellow-500/20 text-yellow-400'
                                            : 'bg-red-500/20 text-red-400'
                                    }`}>
                                    {Math.round(rating)}/100
                                </span>
                            )}
                            {genres.map((g) => (
                                <span
                                    key={g}
                                    className="px-2 py-0.5 bg-panel rounded text-xs text-secondary"
                                >
                                    {g}
                                </span>
                            ))}
                        </div>

                        {/* Summary */}
                        {game.summary && (
                            <p className="text-secondary text-sm leading-relaxed mb-4 line-clamp-4">
                                {game.summary}
                            </p>
                        )}

                        {/* Details grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                            {modes.length > 0 && (
                                <div>
                                    <span className="text-dim">Game Modes</span>
                                    <p className="text-foreground">{modes.join(', ')}</p>
                                </div>
                            )}
                            {game.playerCount && (
                                <div>
                                    <span className="text-dim">Players</span>
                                    <p className="text-foreground">
                                        {game.playerCount.min}–{game.playerCount.max}
                                    </p>
                                </div>
                            )}
                            {platforms.length > 0 && (
                                <div>
                                    <span className="text-dim">Platforms</span>
                                    <p className="text-foreground">{platforms.join(', ')}</p>
                                </div>
                            )}
                            {game.crossplay !== null && (
                                <div>
                                    <span className="text-dim">Crossplay</span>
                                    <p className={`font-medium ${game.crossplay ? 'text-emerald-400' : 'text-secondary'}`}>
                                        {game.crossplay ? 'Supported' : 'Not Available'}
                                    </p>
                                </div>
                            )}
                            {game.firstReleaseDate && (
                                <div>
                                    <span className="text-dim">Released</span>
                                    <p className="text-foreground">
                                        {new Date(game.firstReleaseDate).toLocaleDateString()}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Want to Play */}
            {isAuthenticated && (
                <div className="flex items-center gap-4 mb-8">
                    <button
                        onClick={() => !isToggling && toggle(!wantToPlay)}
                        disabled={isToggling}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors ${wantToPlay
                                ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30'
                                : 'bg-emerald-600 text-white hover:bg-emerald-500'
                            }`}
                    >
                        <svg
                            className={`w-5 h-5 ${wantToPlay ? 'fill-current' : ''}`}
                            fill={wantToPlay ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        {wantToPlay ? 'Remove from List' : 'Want to Play'}
                    </button>
                    {count > 0 && (
                        <span className="text-sm text-muted">
                            {count} player{count !== 1 ? 's' : ''} interested
                        </span>
                    )}
                </div>
            )}

            {/* Screenshots */}
            {game.screenshots.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-foreground mb-3">
                        Screenshots
                    </h2>
                    <ScreenshotGallery
                        screenshots={game.screenshots}
                        gameName={game.name}
                    />
                </section>
            )}

            {/* Twitch Streams */}
            {streamsData && streamsData.streams.length > 0 && (
                <section className="mb-8">
                    <TwitchStreamEmbed
                        streams={streamsData.streams}
                        totalLive={streamsData.totalLive}
                    />
                </section>
            )}

            {/* Trailers */}
            {game.videos.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-foreground mb-3">
                        Trailers
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {game.videos.slice(0, 4).map((video) => (
                            <div
                                key={video.videoId}
                                className="aspect-video rounded-xl overflow-hidden bg-black"
                            >
                                <iframe
                                    src={`https://www.youtube.com/embed/${video.videoId}`}
                                    className="w-full h-full"
                                    allowFullScreen
                                    title={video.name}
                                    loading="lazy"
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
