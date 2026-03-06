import type { JSX } from 'react';
import { useParams, Link, useNavigate, type NavigateFunction } from 'react-router-dom';
import { useGameDetail, useGameStreams } from '../hooks/use-games-discover';
import { useEvents } from '../hooks/use-events';
import { useWantToPlay } from '../hooks/use-want-to-play';
import { useAuth } from '../hooks/use-auth';
import { ScreenshotGallery } from '../components/games/ScreenshotGallery';
import { TwitchStreamEmbed } from '../components/games/TwitchStreamEmbed';
import { EventCard } from '../components/events/event-card';
import { InterestPlayerAvatars } from '../components/games/InterestPlayerAvatars';
import { GENRE_MAP } from '../lib/game-utils';
import { PLATFORM_MAP, MODE_MAP } from './game-detail/game-detail-constants';
import { CommunityActivitySection } from './game-detail/CommunityActivitySection';
import type { EventResponseDto } from '@raid-ledger/contract';

/** Game detail page — shows full game info, activity, events, screenshots, streams */
// eslint-disable-next-line max-lines-per-function
export function GameDetailPage(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const gameId = id ? parseInt(id, 10) : undefined;
    const navigate = useNavigate();

    const { data: game, isLoading, error } = useGameDetail(gameId);
    const { data: streamsData } = useGameStreams(gameId);
    const { isAuthenticated } = useAuth();
    const { wantToPlay, count, source, players, toggle, isToggling } = useWantToPlay(
        isAuthenticated ? gameId : undefined,
    );

    const igdbId = game?.igdbId;
    const { data: eventsData } = useEvents(
        igdbId ? { upcoming: true, gameId: String(igdbId), limit: 4 } : undefined,
    );
    const gameEvents = eventsData?.data;

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
                    <Link to="/games" className="mt-4 inline-block text-emerald-400 hover:text-emerald-300">Back to Games</Link>
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
            <BackButton navigate={navigate} />
            <GameBanner game={game} rating={rating} genres={genres} platforms={platforms} modes={modes} />
            {isAuthenticated && (
                <WantToPlaySection wantToPlay={wantToPlay} count={count} source={source} players={players} toggle={toggle} isToggling={isToggling} gameId={gameId} />
            )}
            {gameId && <CommunityActivitySection gameId={gameId} />}
            {gameEvents && gameEvents.length > 0 && <UpcomingEventsSection events={gameEvents} igdbId={igdbId} navigate={navigate} />}
            {game.screenshots.length > 0 && (
                <section className="mb-8">
                    <h2 className="text-lg font-semibold text-foreground mb-3">Screenshots</h2>
                    <ScreenshotGallery screenshots={game.screenshots} gameName={game.name} />
                </section>
            )}
            {streamsData && streamsData.streams.length > 0 && (
                <section className="mb-8"><TwitchStreamEmbed streams={streamsData.streams} totalLive={streamsData.totalLive} /></section>
            )}
            {game.videos.length > 0 && <TrailersSection videos={game.videos} />}
        </div>
    );
}

/** Smart back button */
function BackButton({ navigate }: { navigate: NavigateFunction }): JSX.Element {
    return (
        <button onClick={() => { if (window.history.length > 1) { navigate(-1); } else { navigate('/games'); } }}
            className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors mb-6 bg-transparent border-none cursor-pointer p-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
        </button>
    );
}

/** Game banner with cover, info, and details grid */
// eslint-disable-next-line max-lines-per-function
function GameBanner({ game, rating, genres, platforms, modes }: {
    game: { name: string; coverUrl: string | null; summary: string | null; playerCount: { min: number; max: number } | null; crossplay: boolean | null; firstReleaseDate: string | null };
    rating: number | null; genres: string[]; platforms: string[]; modes: string[];
}): JSX.Element {
    return (
        <div className="relative rounded-xl overflow-hidden mb-8">
            <div className="absolute inset-0">
                {game.coverUrl && <img src={game.coverUrl} alt="" className="w-full h-full object-cover blur-2xl scale-110 opacity-30" />}
                <div className="absolute inset-0 bg-gradient-to-b from-backdrop/50 to-backdrop" />
            </div>
            <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row gap-6">
                {game.coverUrl && <img src={game.coverUrl} alt={game.name} className="w-40 sm:w-48 aspect-[3/4] object-cover rounded-xl shadow-2xl flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{game.name}</h1>
                    <MetaRow rating={rating} genres={genres} />
                    {game.summary && <p className="text-secondary text-sm leading-relaxed mb-4 line-clamp-4">{game.summary}</p>}
                    <DetailsGrid modes={modes} playerCount={game.playerCount} platforms={platforms} crossplay={game.crossplay} releaseDate={game.firstReleaseDate} />
                </div>
            </div>
        </div>
    );
}

/** Rating and genre badges */
function MetaRow({ rating, genres }: { rating: number | null; genres: string[] }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-3 mb-4">
            {rating && rating > 0 && (
                <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${rating >= 75 ? 'bg-emerald-500/20 text-emerald-400' : rating >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                    {Math.round(rating)}/100
                </span>
            )}
            {genres.map((g) => (<span key={g} className="px-2 py-0.5 bg-panel rounded text-xs text-secondary">{g}</span>))}
        </div>
    );
}

/** Game details grid (modes, players, platforms, crossplay, release date) */
function DetailsGrid({ modes, playerCount, platforms, crossplay, releaseDate }: {
    modes: string[]; playerCount: { min: number; max: number } | null;
    platforms: string[]; crossplay: boolean | null; releaseDate: string | null;
}): JSX.Element {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {modes.length > 0 && <div><span className="text-dim">Game Modes</span><p className="text-foreground">{modes.join(', ')}</p></div>}
            {playerCount && <div><span className="text-dim">Players</span><p className="text-foreground">{playerCount.min}-{playerCount.max}</p></div>}
            {platforms.length > 0 && <div><span className="text-dim">Platforms</span><p className="text-foreground">{platforms.join(', ')}</p></div>}
            {crossplay !== null && <div><span className="text-dim">Crossplay</span><p className={`font-medium ${crossplay ? 'text-emerald-400' : 'text-secondary'}`}>{crossplay ? 'Supported' : 'Not Available'}</p></div>}
            {releaseDate && <div><span className="text-dim">Released</span><p className="text-foreground">{new Date(releaseDate).toLocaleDateString()}</p></div>}
        </div>
    );
}

/** Want to Play button and interest avatars */
// eslint-disable-next-line max-lines-per-function
function WantToPlaySection({ wantToPlay, count, source, players, toggle, isToggling, gameId }: {
    wantToPlay: boolean; count: number; source: string | null | undefined;
    players: { id: number; username: string; avatar: string | null; customAvatarUrl: string | null; discordId: string | null }[];
    toggle: (v: boolean) => void; isToggling: boolean; gameId: number | undefined;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-4 mb-8">
            <button onClick={() => !isToggling && toggle(!wantToPlay)} disabled={isToggling}
                title={source === 'discord' ? 'Auto-hearted based on your playtime' : undefined}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors ${wantToPlay
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}>
                <svg className={`w-5 h-5 ${wantToPlay ? 'fill-current' : ''}`} fill={wantToPlay ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {wantToPlay ? 'Remove from List' : 'Want to Play'}
            </button>
            {count > 0 && <InterestPlayerAvatars players={players} totalCount={count} maxVisible={6} gameId={gameId} />}
        </div>
    );
}

/** Upcoming events for this game */
function UpcomingEventsSection({ events, igdbId, navigate }: {
    events: { id: number; signupCount: number; [k: string]: unknown }[];
    igdbId: number | null | undefined; navigate: NavigateFunction;
}): JSX.Element {
    return (
        <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-foreground">Upcoming Events</h2>
                <Link to={`/events?gameId=${igdbId}`} className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">View all</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {events.slice(0, 4).map((event) => (
                    <EventCard key={event.id} event={event as EventResponseDto} signupCount={event.signupCount} onClick={() => navigate(`/events/${event.id}`)} />
                ))}
            </div>
        </section>
    );
}

/** Trailers / YouTube embeds section */
function TrailersSection({ videos }: { videos: { videoId: string; name?: string }[] }): JSX.Element {
    return (
        <section className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">Trailers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {videos.slice(0, 4).map((video) => (
                    <div key={video.videoId} className="aspect-video rounded-xl overflow-hidden bg-black">
                        <iframe src={`https://www.youtube.com/embed/${video.videoId}`} className="w-full h-full" allowFullScreen title={video.name ?? 'Trailer'} loading="lazy" />
                    </div>
                ))}
            </div>
        </section>
    );
}
