import type { JSX } from 'react';
import type { GameDetailDto, GameDiscoverRowDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { GameCarousel } from '../components/games/GameCarousel';
import { DrawerCard } from '../components/games/DrawerCard';

export type PricingMap = Map<number, ItadGamePricingDto | null>;

type RowMetadata = GameDiscoverRowDto['metadata'];

const PLAYED_BADGE_CLS =
    'absolute top-2 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-md text-xs font-semibold bg-black/70 text-white backdrop-blur-sm whitespace-nowrap pointer-events-none';

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
            <DrawerCard game={game} pricing={pricing} />
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

function CuratedSection({
    rows,
    pricingMap,
}: {
    rows: GameDiscoverRowDto[];
    pricingMap: PricingMap;
}): JSX.Element {
    return (
        <section
            data-testid="curated-dynamic-section"
            className="border-l-2 border-emerald-500/40 pl-4 md:pl-5"
        >
            <div className="mb-4">
                <h2 className="text-sm font-medium text-emerald-300/90 uppercase tracking-wider">
                    Curated This Week
                </h2>
            </div>
            <div className="hidden md:block space-y-6">
                {rows.map((row) => (
                    <GameCarousel
                        key={row.slug}
                        category={row.category}
                        games={row.games}
                        pricingMap={pricingMap}
                        metadata={row.metadata}
                        clickMode="drawer"
                    />
                ))}
            </div>
            <div className="md:hidden space-y-5">
                {rows.map((row) => (
                    <MobileDiscoverRow
                        key={row.slug}
                        row={row}
                        pricingMap={pricingMap}
                    />
                ))}
            </div>
        </section>
    );
}

/**
 * The whole Discover grid — both trees.
 *
 * ROK-1525: the testid is what lets an absence assertion say "gone from the
 * FILTERED grid" instead of "gone from the page". The page-wide form is only
 * as true as the claim that nothing else here links to `/games/:id`, which is
 * a claim about every banner and prompt on the route rather than about the
 * filter under test.
 */
export const DISCOVER_GRID_TESTID = 'discover-grid';

export function DiscoverRows({
    filteredRows,
    pricingMap,
}: {
    filteredRows: GameDiscoverRowDto[];
    pricingMap: PricingMap;
}): JSX.Element {
    const dynamicRows = filteredRows.filter((r) => r.isDynamic);
    const staticRows = filteredRows.filter((r) => !r.isDynamic);
    return (
        <div data-testid={DISCOVER_GRID_TESTID} className="space-y-8">
            {dynamicRows.length > 0 && (
                <CuratedSection rows={dynamicRows} pricingMap={pricingMap} />
            )}
            <div className="hidden md:block space-y-8">
                {staticRows.map((row) => (
                    <GameCarousel
                        key={row.slug}
                        category={row.category}
                        games={row.games}
                        pricingMap={pricingMap}
                        metadata={row.metadata}
                        clickMode="drawer"
                    />
                ))}
            </div>
            <div className="md:hidden space-y-6">
                {staticRows.map((row) => (
                    <MobileDiscoverRow
                        key={row.slug}
                        row={row}
                        pricingMap={pricingMap}
                    />
                ))}
            </div>
        </div>
    );
}

/** What the empty state needs to know beyond "the grid came back empty". */
export interface DiscoverEmptyState {
    /** A player/owner predicate is currently narrowing the grid. */
    isLibraryFiltered: boolean;
    /** The library had rows BEFORE any predicate ran. */
    hasLibraryRows: boolean;
    /** Drops `players` + `owners`; leaves `lfg` / `q` / `genres` alone. */
    onClearFilters: () => void;
}

/**
 * ROK-1525 B2 — the grid emptied by a player/owner predicate.
 *
 * Its own state because the two inherited ones both misreport it: "No games in
 * the library yet" is false on a stocked library, and "No games match this
 * genre" blames a row that may not even be selected. This one names the cause
 * and hands back the control that undoes it.
 */
function LibraryFiltersEmpty({ onClearFilters }: { onClearFilters: () => void }): JSX.Element {
    return (
        <div data-testid="library-filters-empty" className="text-center py-16">
            <p className="text-muted text-lg">No games match these filters</p>
            <p className="text-dim text-sm mt-1">
                Try a different player count, or clear the filters to see the whole library.
            </p>
            <button
                type="button"
                onClick={onClearFilters}
                className="mt-4 inline-flex items-center px-4 py-2 min-h-[44px] rounded-full text-sm font-medium bg-panel border border-edge text-secondary hover:bg-overlay transition-colors"
            >
                Clear filters
            </button>
        </div>
    );
}

/** The pre-ROK-1525 copy: a genre narrowing, or a library with nothing in it. */
function GenreOrLibraryEmpty({ hasGenre }: { hasGenre: boolean }): JSX.Element {
    return (
        <div className="text-center py-16">
            <p className="text-muted text-lg">
                {hasGenre ? 'No games match this genre' : 'No games in the library yet'}
            </p>
            <p className="text-dim text-sm mt-1">
                {hasGenre
                    ? 'Try selecting a different genre'
                    : 'Games will appear here once synced from IGDB'}
            </p>
        </div>
    );
}

export function DiscoverContent({
    discoverLoading,
    filteredRows,
    selectedGenres,
    pricingMap,
    emptyState,
}: {
    discoverLoading: boolean;
    filteredRows: GameDiscoverRowDto[] | undefined;
    selectedGenres: Set<string>;
    pricingMap: PricingMap;
    emptyState: DiscoverEmptyState;
}): JSX.Element {
    if (discoverLoading) return <DiscoverLoadingSkeleton />;
    if (filteredRows && filteredRows.length > 0) {
        return <DiscoverRows filteredRows={filteredRows} pricingMap={pricingMap} />;
    }
    // A library predicate only earns the blame when there WAS something to
    // narrow; on a library with no rows at all the old copy is still the true
    // one, filters or no filters.
    if (emptyState.isLibraryFiltered && emptyState.hasLibraryRows) {
        return <LibraryFiltersEmpty onClearFilters={emptyState.onClearFilters} />;
    }
    return <GenreOrLibraryEmpty hasGenre={selectedGenres.size > 0} />;
}
