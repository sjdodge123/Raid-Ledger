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
import { SteamIcon } from '../components/icons/SteamIcon';
import { GENRE_MAP } from '../lib/game-utils';
import { PLATFORM_MAP, MODE_MAP } from './game-detail/game-detail-constants';
import type { InterestPlayerPreviewDto } from '@raid-ledger/contract';
import { CommunityActivitySection } from './game-detail/CommunityActivitySection';
import { CoopFeaturesSection } from './game-detail/CoopFeaturesSection';
import { GameTasteSection } from './game-detail/taste-vector/GameTasteSection';
import { GameBanner } from './game-detail/GameBanner';
import { LineupVoteBanner } from '../components/lineups/LineupVoteBanner';
import { useGamePricing } from '../hooks/use-games-discover';
import type { EventResponseDto } from '@raid-ledger/contract';

/** Game detail page — shows full game info, activity, events, screenshots, streams */
export function GameDetailPage(): JSX.Element {
    const { id } = useParams<{ id: string }>();
    const gameId = id ? parseInt(id, 10) : undefined;
    const navigate = useNavigate();

    const { data: game, isLoading, error } = useGameDetail(gameId);
    const { data: streamsData } = useGameStreams(gameId);
    const { isAuthenticated } = useAuth();
    const wtp = useWantToPlay(isAuthenticated ? gameId : undefined);

    const igdbId = game?.igdbId;
    const { data: eventsData } = useEvents(
        igdbId ? { upcoming: true, gameId: String(igdbId), limit: 4 } : undefined,
    );

    if (isLoading) return <GameDetailLoading />;
    if (error || !game) return <GameNotFound />;

    return (
        <GameDetailContent game={game} gameId={gameId} navigate={navigate}
            streamsData={streamsData} isAuthenticated={isAuthenticated}
            wtp={wtp} gameEvents={eventsData?.data} igdbId={igdbId} />
    );
}

function GameDetailLoading(): JSX.Element {
    return (
        <div className="max-w-5xl mx-auto px-4 py-8 animate-pulse">
            <div className="h-64 bg-overlay rounded-xl mb-8" />
            <div className="h-8 bg-overlay rounded w-1/3 mb-4" />
            <div className="h-4 bg-overlay rounded w-2/3 mb-2" />
            <div className="h-4 bg-overlay rounded w-1/2" />
        </div>
    );
}

function GameNotFound(): JSX.Element {
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

function GameDetailContent({ game, gameId, navigate, streamsData, isAuthenticated, wtp, gameEvents, igdbId }: {
    game: NonNullable<ReturnType<typeof useGameDetail>['data']>; gameId: number | undefined; navigate: NavigateFunction;
    streamsData: ReturnType<typeof useGameStreams>['data']; isAuthenticated: boolean;
    wtp: ReturnType<typeof useWantToPlay>; gameEvents: EventResponseDto[] | undefined; igdbId: number | null | undefined;
}): JSX.Element {
    const rating = game.aggregatedRating ?? game.rating;
    const genres = game.genres.map((id) => GENRE_MAP[id]).filter(Boolean);
    const platforms = game.platforms.map((id) => PLATFORM_MAP[id]).filter(Boolean);
    const modes = game.gameModes.map((id) => MODE_MAP[id]).filter(Boolean);
    const { data: pricingResponse } = useGamePricing(gameId, !!game.itadGameId);
    const pricing = pricingResponse?.data ?? null;

    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <BackButton navigate={navigate} />
            {gameId && <LineupVoteBanner gameId={gameId} />}
            <GameBanner game={game} rating={rating} genres={genres} platforms={platforms} modes={modes} pricing={pricing} />
            {isAuthenticated && (
                <div className="flex flex-wrap items-center gap-6 mb-8" data-testid="player-stats-row">
                    <WantToPlaySection wantToPlay={wtp.wantToPlay} count={wtp.count} source={wtp.source} players={wtp.players} toggle={wtp.toggle} isToggling={wtp.isToggling} gameId={gameId} />
                    <OwnedBySection owners={wtp.owners ?? []} ownerCount={wtp.ownerCount ?? 0} gameId={gameId} />
                    <WishlistedBySection wishlisters={wtp.wishlisters ?? []} wishlistedCount={wtp.wishlistedCount ?? 0} gameId={gameId} />
                </div>
            )}
            <CoopSupportAndActivity game={game} gameId={gameId} />
            {gameEvents && gameEvents.length > 0 && <UpcomingEventsSection events={gameEvents} igdbId={igdbId} navigate={navigate} />}
            <GameMediaSections game={game} streamsData={streamsData} />
            <GameTasteSection gameId={gameId} />
        </div>
    );
}

/**
 * Co-Optimus co-op facts (ROK-1398) followed by community activity. The co-op
 * section renders nothing for games Co-Optimus has never been asked about.
 */
function CoopSupportAndActivity({ game, gameId }: {
    game: NonNullable<ReturnType<typeof useGameDetail>['data']>; gameId: number | undefined;
}): JSX.Element {
    return (
        <>
            <CoopFeaturesSection game={game} />
            {gameId && <CommunityActivitySection gameId={gameId} />}
        </>
    );
}

function GameMediaSections({ game, streamsData }: {
    game: { screenshots: string[]; videos: { videoId: string; name?: string }[]; name: string };
    streamsData: ReturnType<typeof useGameStreams>['data'];
}): JSX.Element {
    return (
        <>
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
        </>
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

/** Want to Play button and interest avatars */
function WantToPlaySection({ wantToPlay, count, source, players, toggle, isToggling, gameId }: {
    wantToPlay: boolean; count: number; source: string | null | undefined;
    players: { id: number; username: string; avatar: string | null; customAvatarUrl: string | null; discordId: string | null }[];
    toggle: (v: boolean) => void; isToggling: boolean; gameId: number | undefined;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-4">
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

/** Steam ownership section with avatars (ROK-745) */
function OwnedBySection({ owners, ownerCount, gameId }: {
    owners: InterestPlayerPreviewDto[]; ownerCount: number; gameId: number | undefined;
}): JSX.Element | null {
    if (ownerCount === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-4">
            <SteamIcon className="w-5 h-5 text-muted" />
            <InterestPlayerAvatars
                players={owners} totalCount={ownerCount} maxVisible={6}
                linkTo={gameId ? `/players?gameId=${gameId}&sources=steam_library` : undefined}
                formatLabel={(total, overflow) => overflow > 0 ? `+${overflow} more` : `${total} player${total !== 1 ? 's' : ''} own${total === 1 ? 's' : ''} this`}
            />
        </div>
    );
}

/** Steam wishlist section with avatars (ROK-774) */
function WishlistedBySection({ wishlisters, wishlistedCount, gameId }: {
    wishlisters: InterestPlayerPreviewDto[]; wishlistedCount: number; gameId: number | undefined;
}): JSX.Element | null {
    if (wishlistedCount === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-4">
            <SteamIcon className="w-5 h-5 text-muted" />
            <InterestPlayerAvatars
                players={wishlisters} totalCount={wishlistedCount} maxVisible={6}
                linkTo={gameId ? `/players?gameId=${gameId}&sources=steam_wishlist` : undefined}
                formatLabel={(total, overflow) => overflow > 0 ? `+${overflow} more` : `${total} player${total !== 1 ? 's' : ''} wishlisted`}
            />
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
