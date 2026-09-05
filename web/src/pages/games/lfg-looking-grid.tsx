/**
 * The `?lfg=1` view of the Library (ROK-1453 AC3).
 *
 * NOT a filter over the Discover carousels. `GET /lfg` returns every game with
 * a live intent, and most of them are in no carousel at all — the operator walk
 * found a banner promising three games and a page showing one, because the
 * filter could only ever narrow rows the Discover endpoint had already chosen.
 * This grid is built from the LFG rows themselves, so the banner's count and
 * the tiles agree by construction.
 *
 * The rows carry everything a tile needs (`gameId`, `gameName`, `gameSlug`,
 * `gameCoverUrl`); rating, genre and pricing simply do not render, and the chip
 * comes from the surrounding `LfgGroupsProvider` exactly as on any other tile.
 */
import type { JSX } from 'react';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { UnifiedGameCard } from '../../components/games/unified-game-card';
import { useLfgGroups } from '../../hooks/use-lfg-groups';

/** Project an LFG row onto the minimal shape `UnifiedGameCard` accepts. */
function toTileGame(group: LfgGroupSummaryDto) {
    return {
        id: group.gameId,
        name: group.gameName,
        slug: group.gameSlug,
        coverUrl: group.gameCoverUrl,
        cooptimusOnlineMax: group.viabilityThreshold,
    };
}

/** One tile, tagged so the smoke spec can count the grid against `GET /lfg`. */
function LookingTile({ group }: { group: LfgGroupSummaryDto }): JSX.Element {
    return (
        <div data-testid="lfg-looking-tile">
            <UnifiedGameCard variant="link" game={toTileGame(group)} />
        </div>
    );
}

/** Every game somebody is currently looking to play. */
export function LfgLookingGrid(): JSX.Element | null {
    const { data, isSuccess, isLoading } = useLfgGroups();
    const groups = data ?? [];

    if (isLoading) {
        return <p className="text-muted text-sm py-8">Loading…</p>;
    }
    // `GET /lfg` is jwt-gated, so for a logged-out viewer the query never runs
    // and `data` stays undefined: that is "we do not know", not "nobody is
    // looking". Only a RESOLVED empty list earns the empty copy.
    if (!isSuccess) return null;
    if (groups.length === 0) {
        return (
            <div className="text-center py-16">
                <p className="text-muted text-lg">Nobody is looking right now</p>
                <p className="text-dim text-sm mt-1">
                    Raise your hand on a game and it shows up here.
                </p>
            </div>
        );
    }

    return (
        <>
            <h2 className="text-lg font-semibold text-foreground mb-3">
                Players are looking
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {groups.map((group) => (
                    <LookingTile key={group.gameId} group={group} />
                ))}
            </div>
        </>
    );
}
