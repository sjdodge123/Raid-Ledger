import type { JSX } from 'react';
import { useState, useCallback, useMemo } from 'react';
import type { GameDetailDto, ItadGamePricingDto } from '@raid-ledger/contract';
import { GameResearchDrawer } from './GameResearchDrawer';
import { GENRE_MAP } from '../../lib/game-utils';
import { useLibraryFilterParams } from '../../pages/games/use-library-filter-params';
import { presetForPlayerCount } from '../../pages/games/library-filter.helpers';
import {
    CoverImage,
    CoverPlaceholder,
    RatingBadge,
    GradientOverlay,
    CardTitle,
    GenreBadge,
} from './game-card-parts';
import { PriceBadge } from './PriceBadge';
import { GameBadgeRow, type GameBadgeActivation } from './game-badges';
import { fromGameDetail } from './game-badges.helpers';

/**
 * ROK-1295 demo integration card for the `/games` index carousel.
 * Replaces the Link-based UnifiedGameCard with a button that opens the
 * universal GameResearchDrawer in-place (no navigation).
 *
 * Carries the `game-ref-row` testid expected by the Playwright spec.
 *
 * ROK-1525 restructured it: the info strip is no longer inside the button. Its
 * badges are now filter affordances ("use badged content as clickable elements
 * as well"), and an activatable element nested inside a `<button>` is an
 * invalid content model — so the strip is a SIBLING overlay in the `CardLfgChip`
 * manner (`unified-game-card-parts.tsx:111-142`), passing clicks through to the
 * card beneath everywhere except on a pill. `DrawerCard.test.tsx` pins that with
 * a `button button` guard.
 *
 * Deliberately the ONLY surface with clickable badges: `UnifiedGameCard` (which
 * hosts the Discover-tab SEARCH results), `CommonGroundGameCard`,
 * `NominationCard`, the veto cards and game-detail are untouched. ROK-1129
 * unifies them; doing this on each of them first means doing it twice.
 */
interface DrawerCardProps {
    game: GameDetailDto;
    pricing: ItadGamePricingDto | null;
}

function CoverContent({
    game,
    rating,
}: {
    game: GameDetailDto;
    rating: number | null;
}): JSX.Element {
    return (
        <div className="relative aspect-[3/4] bg-panel">
            {game.coverUrl ? <CoverImage src={game.coverUrl} alt={game.name} /> : <CoverPlaceholder />}
            {rating != null && <RatingBadge rating={rating} />}
            <GradientOverlay />
        </div>
    );
}

/**
 * Title + badge strip, overlaid on the cover as a sibling of the card button.
 *
 * `pointer-events-none` is what keeps the card's own click target intact: the
 * title and the inert badges pass their clicks straight through to the button
 * underneath, and only an activatable pill (which re-enables pointer events on
 * itself) swallows one.
 */
function CardInfoStrip({ game, activation }: {
    game: GameDetailDto;
    activation: GameBadgeActivation;
}): JSX.Element {
    const primaryGenre = game.genres?.[0] != null ? GENRE_MAP[game.genres[0]] ?? null : null;
    return (
        <div className="absolute bottom-0 left-0 right-0 p-3 pointer-events-none">
            <CardTitle name={game.name} />
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {primaryGenre && <GenreBadge label={primaryGenre} />}
                {/* ROK-1314: the drawer card already renders PriceBadge from
                    the ITAD pricing payload, so the row prints no price. */}
                <GameBadgeRow
                    game={fromGameDetail(game)}
                    variant="full"
                    price="none"
                    activation={activation}
                />
            </div>
        </div>
    );
}

/**
 * Map the card's own data to the library filter writers (ROK-1525).
 *
 * A slot is omitted — leaving that badge the inert span it has always been —
 * when the data cannot express a filter: a `1 player` range seats no preset
 * (2/3/4/5+ all need `max >= 2`) and a zero/absent owner count is not a floor.
 * `toggleMinOwners` / `togglePlayersFilter` copy the previous params and write
 * with `{ replace: true }`, so `lfg`, `q` and genre survive and a swept row of
 * badges does not stack history entries.
 */
function useBadgeActivation(game: GameDetailDto): GameBadgeActivation {
    const { togglePlayersFilter, toggleMinOwners } = useLibraryFilterParams();
    const preset = presetForPlayerCount(game.playerCount);
    const ownerCount = game.ownerCount ?? null;
    return useMemo(
        () => ({
            ...(preset != null
                ? {
                      players: {
                          label: `Filter to games for ${preset.label} players`,
                          onActivate: () => togglePlayersFilter(preset.key),
                      },
                  }
                : {}),
            ...(ownerCount != null && ownerCount > 0
                ? {
                      owners: {
                          label: `Filter to games at least ${ownerCount} members own`,
                          onActivate: () => toggleMinOwners(ownerCount),
                      },
                  }
                : {}),
        }),
        [preset, ownerCount, togglePlayersFilter, toggleMinOwners],
    );
}

/**
 * The card's own click target. Keeps the `game-ref-row` testid the Playwright
 * spec (`scripts/smoke/game-research-drawer.smoke.spec.ts`) pins, and holds
 * nothing activatable — see the module note.
 */
function CardButton({ game, pricing, onOpen }: DrawerCardProps & { onOpen: () => void }): JSX.Element {
    const rating = game.aggregatedRating ?? game.rating ?? null;
    return (
        <button
            type="button"
            data-testid="game-ref-row"
            onClick={onOpen}
            className="block relative w-full text-left"
            aria-label={`Research ${game.name}`}
        >
            <CoverContent game={game} rating={rating && rating > 0 ? rating : null} />
            {pricing && (
                <div className="absolute top-2 left-2">
                    <PriceBadge pricing={pricing} />
                </div>
            )}
        </button>
    );
}

export function DrawerCard({ game, pricing }: DrawerCardProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const activation = useBadgeActivation(game);
    return (
        <>
            <div className="group relative rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/20 transition-all">
                <CardButton game={game} pricing={pricing} onOpen={open} />
                <CardInfoStrip game={game} activation={activation} />
            </div>
            <GameResearchDrawer isOpen={isOpen} onClose={close} gameId={game.id} />
        </>
    );
}
