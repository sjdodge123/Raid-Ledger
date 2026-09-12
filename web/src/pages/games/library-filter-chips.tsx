/**
 * ROK-1525 — the player-count / ownership chip row on the Discover tab.
 *
 * Operator rulings (2026-09-12): the N control is the preset set 2 / 3 / 4 / 5+,
 * "N players" means SUPPORTS N, `N own` means owned by at least N members, and
 * the whole thing ANDs with `Players are looking` + the genre row while living
 * in the URL the way ROK-1478's filter does.
 *
 * This row is deliberately a copy of `lfg-filter-chip.tsx:24-55` in every
 * respect that the eye can see — the pill geometry, the amber ON tokens, the
 * muted OFF tokens, the 44px target, `aria-pressed` on a `<button type=
 * "button">` and the `mb-4 flex items-center gap-2` wrapper. The three class
 * strings below are duplicated rather than imported because that file is not
 * this story's to edit; if a fifth chip ever appears, promoting them to a
 * shared module is the right move, not a fourth copy.
 *
 * It is mounted as its OWN row next to the `lfg` chip rather than inside
 * `CoopFilterSection`: that section is dormant until the first Co-Optimus sync
 * lands (`games-page.tsx:139-149`), and these predicates read IGDB
 * `playerCount` / `ownerCount`, which are present today.
 *
 * NULL semantics are DISCLOSED, not silent — a game with no IGDB range cannot
 * answer "supports 4" and is dropped, so the hint line says so. That is the
 * `coop-filter-section.tsx:90-99` precedent, and it is the difference between
 * a filter and an unexplained empty grid.
 */
import type { JSX } from 'react';
import { PLAYER_COUNT_PRESETS } from './library-filter.helpers';
import { useLibraryFilterParams, type LibraryFilterParams } from './use-library-filter-params';

/** Verbatim from `lfg-filter-chip.tsx:24-31` — see the module note above. */
const BASE_CLS =
    'inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors';

const ON_CLS =
    'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20';

const OFF_CLS =
    'bg-panel border border-edge text-secondary hover:bg-overlay';

/**
 * The owners chip's default N. The badge-driven writes of slice 4 can set any
 * positive integer, so the chip renders whatever `owners` currently holds and
 * only falls back to this when the filter is off.
 */
const DEFAULT_OWNERS_MIN = 2;

function chipCls(isOn: boolean): string {
    return `${BASE_CLS} ${isOn ? ON_CLS : OFF_CLS} whitespace-nowrap`;
}

/** The 2 / 3 / 4 / 5+ toggles. Labels come from the preset const, never typed. */
function PlayerCountChips({ filters }: { filters: LibraryFilterParams }): JSX.Element {
    const { playersFilter, togglePlayersFilter } = filters;
    return (
        <>
            {PLAYER_COUNT_PRESETS.map((preset) => {
                const isOn = playersFilter === preset.key;
                return (
                    <button
                        key={preset.key}
                        type="button"
                        data-testid={`player-count-chip-${preset.key}`}
                        aria-pressed={isOn}
                        aria-label={`${preset.label} players`}
                        onClick={() => togglePlayersFilter(preset.key)}
                        className={chipCls(isOn)}
                    >
                        {preset.label}
                    </button>
                );
            })}
        </>
    );
}

/** "owned by at least N members" as a single toggle (operator ruling 3). */
function OwnersChip({ filters }: { filters: LibraryFilterParams }): JSX.Element {
    const { minOwners, toggleMinOwners } = filters;
    const isOn = minOwners !== null;
    const target = minOwners ?? DEFAULT_OWNERS_MIN;
    return (
        <button
            type="button"
            data-testid="owners-filter-chip"
            aria-pressed={isOn}
            onClick={() => toggleMinOwners(target)}
            className={chipCls(isOn)}
        >
            {`👥 ${target}+ own`}
        </button>
    );
}

/** Which kinds of missing data are currently costing a game its place. */
function hintText(hasPlayers: boolean, hasOwners: boolean): string {
    const parts: string[] = [];
    if (hasPlayers) parts.push('player-count');
    if (hasOwners) parts.push('ownership');
    return `Showing only games with ${parts.join(' and ')} data`;
}

/**
 * NULL-semantics disclosure (the `CoopFilterHint` precedent): a game with no
 * IGDB range / no owner aggregate cannot satisfy the predicate and is hidden,
 * so say it out loud while the predicate is on.
 */
function LibraryFilterHint({ filters }: { filters: LibraryFilterParams }): JSX.Element {
    return (
        <p data-testid="library-filter-hint" className="mt-1 text-xs text-muted">
            {hintText(filters.playersFilter !== null, filters.minOwners !== null)}
        </p>
    );
}

/**
 * The whole row. Rendered unconditionally — the data these predicates read is
 * already on every card, so there is no dormant state to guard against, and a
 * filter restored from the URL must always have a control that can clear it.
 */
export function LibraryFilterChips(): JSX.Element {
    const filters = useLibraryFilterParams();
    return (
        <div className="mb-4">
            <div
                className="flex items-center gap-2 overflow-x-auto pb-1"
                style={{ scrollbarWidth: 'none' }}
            >
                <span className="text-sm text-muted whitespace-nowrap">Players</span>
                <PlayerCountChips filters={filters} />
                <OwnersChip filters={filters} />
            </div>
            {filters.isLibraryFiltered && <LibraryFilterHint filters={filters} />}
        </div>
    );
}
