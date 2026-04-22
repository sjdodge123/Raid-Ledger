import type { JSX } from 'react';
import type { GameDetailDto, GameDiscoverRowDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { GameCarousel } from '../components/games/GameCarousel';
import { UnifiedGameCard } from '../components/games/unified-game-card';

export type PricingMap = Map<number, ItadGamePricingDto | null>;

type RowMetadata = GameDiscoverRowDto['metadata'];

const PLAYED_BADGE_CLS =
    'absolute top-2 left-2 z-10 px-2 py-0.5 rounded-md text-xs font-semibold bg-black/70 text-white backdrop-blur-sm';

function formatPlayedLabel(count: number): string {
    return `${new Intl.NumberFormat('en-US').format(count)} played`;
}

function PlayedBadge({ count }: { count: number }): JSX.Element {
    return (
        <span data-testid="community-played-badge" className={PLAYED_BADGE_CLS}>
            {formatPlayedLabel(count)}
        </span>
    );
}

function MobileDiscoverCard({
    game,
    pricing,
    playerCount,
}: {
    game: GameDetailDto;
    pricing: ItadGamePricingDto | null;
    playerCount: number | undefined;
}): JSX.Element {
    return (
        <div className="relative min-w-[180px] w-[180px] flex-shrink-0 snap-start">
            {playerCount !== undefined && playerCount >= 1 && <PlayedBadge count={playerCount} />}
            <UnifiedGameCard variant="link" game={game} compact showRating pricing={pricing} />
        </div>
    );
}

export function MobileDiscoverRow({
    row,
    pricingMap,
}: {
    row: GameDiscoverRowDto;
    pricingMap: PricingMap;
}): JSX.Element {
    const metadata: RowMetadata = row.metadata;
    return (
        <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">{row.category}</h2>
            <div
                className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 scroll-pl-4"
                style={{ scrollbarWidth: 'none' }}
            >
                {row.games.map((game) => (
                    <MobileDiscoverCard
                        key={game.id}
                        game={game}
                        pricing={pricingMap.get(game.id) ?? null}
                        playerCount={metadata?.[String(game.id)]?.playerCount}
                    />
                ))}
            </div>
        </div>
    );
}

export function DiscoverLoadingSkeleton(): JSX.Element {
    return (
        <div className="space-y-8">
            {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                    <div className="h-6 bg-overlay rounded w-48 mb-3" />
                    <div className="flex gap-4">
                        {Array.from({ length: 6 }).map((_, j) => (
                            <div key={j} className="w-[180px] flex-shrink-0">
                                <div className="aspect-[3/4] bg-overlay rounded-xl" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function DiscoverRows({
    filteredRows,
    pricingMap,
}: {
    filteredRows: GameDiscoverRowDto[];
    pricingMap: PricingMap;
}): JSX.Element {
    return (
        <div className="space-y-8">
            <div className="hidden md:block space-y-8">
                {filteredRows.map((row) => (
                    <GameCarousel
                        key={row.slug}
                        category={row.category}
                        games={row.games}
                        pricingMap={pricingMap}
                        metadata={row.metadata}
                    />
                ))}
            </div>
            <div className="md:hidden space-y-6">
                {filteredRows.map((row) => (
                    <MobileDiscoverRow key={row.slug} row={row} pricingMap={pricingMap} />
                ))}
            </div>
        </div>
    );
}

export function DiscoverContent({
    discoverLoading,
    filteredRows,
    selectedGenres,
    pricingMap,
}: {
    discoverLoading: boolean;
    filteredRows: GameDiscoverRowDto[] | undefined;
    selectedGenres: Set<string>;
    pricingMap: PricingMap;
}): JSX.Element {
    if (discoverLoading) return <DiscoverLoadingSkeleton />;
    if (filteredRows && filteredRows.length > 0) {
        return <DiscoverRows filteredRows={filteredRows} pricingMap={pricingMap} />;
    }
    return (
        <div className="text-center py-16">
            <p className="text-muted text-lg">No games in the library yet</p>
            <p className="text-dim text-sm mt-1">
                {selectedGenres.size > 0
                    ? 'Try selecting a different genre'
                    : 'Games will appear here once synced from IGDB'}
            </p>
        </div>
    );
}
