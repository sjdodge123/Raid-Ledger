/**
 * Game-detail banner, extracted from `game-detail-page.tsx` under ROK-1453.
 *
 * The page sat at 290/300 counted lines, so the meta row could not grow to
 * carry the LFG chip without breaking the ESLint cap. Everything here is the
 * banner's own presentation; the only new behaviour is the single
 * `GET /lfg/:gameId` read that feeds the chip (one game, one request — the
 * page-level provider is a games-page concern).
 */
import type { JSX } from 'react';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { SteamIcon } from '../../components/icons/SteamIcon';
import { PriceBadge } from '../../components/games/PriceBadge';
import { LfgChip } from '../../components/lfg/lfg-chip';
import { useLfgGroupDetail } from '../../hooks/use-lfg-groups';
import { GamePricingSummary } from './GamePricingSummary';

/** The banner's slice of `GameDetailDto`. */
export interface GameBannerGame {
    id: number;
    slug: string;
    name: string;
    coverUrl: string | null;
    itadBoxartUrl?: string | null;
    summary: string | null;
    playerCount: { min: number; max: number } | null;
    crossplay: boolean | null;
    firstReleaseDate: string | null;
    steamAppId?: number | null;
}

/** External "View on Steam" link for the banner — same pattern as the ITAD deal link. */
function SteamStoreLink({ appId }: { appId: number }): JSX.Element {
    return (
        <a
            href={`https://store.steampowered.com/app/${appId}/`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="steam-store-link"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
            <SteamIcon className="w-4 h-4" />
            View on Steam &rarr;
        </a>
    );
}

/** Game banner with cover, info, and details grid. ROK-773: IGDB cover > ITAD boxart > none */
export function GameBanner({ game, rating, genres, platforms, modes, pricing }: {
    game: GameBannerGame;
    rating: number | null; genres: string[]; platforms: string[]; modes: string[]; pricing: ItadGamePricingDto | null;
}): JSX.Element {
    const displayCover = game.coverUrl ?? game.itadBoxartUrl ?? null;
    return (
        <div className="relative rounded-xl overflow-hidden mb-8">
            <div className="absolute inset-0">
                {displayCover && <img src={displayCover} alt="" className="w-full h-full object-cover blur-2xl scale-110 opacity-30" />}
                <div className="absolute inset-0 bg-gradient-to-b from-backdrop/50 to-backdrop" />
            </div>
            <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row gap-6">
                {displayCover && (
                    <div className="relative w-40 sm:w-48 aspect-[3/4] flex-shrink-0 overflow-hidden rounded-xl shadow-2xl bg-panel">
                        <img src={displayCover} alt={game.name} className="absolute inset-0 h-full w-full object-cover" />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">{game.name}</h1>
                    <MetaRow game={game} rating={rating} genres={genres} pricing={pricing} />
                    {game.summary && <p className="text-secondary text-sm leading-relaxed mb-4 line-clamp-4">{game.summary}</p>}
                    <DetailsGrid modes={modes} playerCount={game.playerCount} platforms={platforms} crossplay={game.crossplay} releaseDate={game.firstReleaseDate} />
                    {pricing && <GamePricingSummary pricing={pricing} />}
                    {game.steamAppId != null && (
                        <div className="mt-2 flex justify-end">
                            <SteamStoreLink appId={game.steamAppId} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Rating, genre, price and LFG badges (ROK-1453 AC1). */
function MetaRow({ game, rating, genres, pricing }: { game: GameBannerGame; rating: number | null; genres: string[]; pricing: ItadGamePricingDto | null }): JSX.Element {
    const { data: group } = useLfgGroupDetail(game.id);
    return (
        <div className="flex flex-wrap items-center gap-3 mb-4">
            {rating && rating > 0 && (
                <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${rating >= 75 ? 'bg-emerald-500/20 text-emerald-400' : rating >= 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                    {Math.round(rating)}/100
                </span>
            )}
            {genres.map((g) => (<span key={g} className="px-2 py-0.5 bg-panel rounded text-xs text-secondary">{g}</span>))}
            <PriceBadge pricing={pricing} className="px-2.5 py-1 text-xs" />
            <LfgChip
                activeCount={group?.activeCount}
                viabilityThreshold={group?.viabilityThreshold}
                state={group?.state}
                gameSlug={game.slug}
            />
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
