/**
 * ROK-1659 — the /games filter set, one field per concern. `GamesFilterBody`
 * composes them as the `FilterEntry` body (inline panel at 1024px and up, the
 * BottomSheet below). They replace the retired chip rows (`LfgFilterChip`,
 * `LibraryFilterChips`, `DesktopGenrePills`) and the genre-only sheet; every
 * value still lives in the URL (`lfg`, `players`, `owners`, `genres`) through
 * the same hooks, so existing deep links keep working.
 */
import type { JSX, ReactNode } from 'react';
import { Switch } from '../../components/ui/switch';
import { Checkbox } from '../../components/ui/checkbox';
import { RadioGroup } from '../../components/ui/radio-group';
import { GENRE_FILTERS } from './games-constants';
import { PLAYER_COUNT_PRESETS } from './library-filter.helpers';
import type { LibraryFilterParams } from './use-library-filter-params';

/** Same legend treatment as the `RadioGroup` primitive, so the groups read as one set. */
const LEGEND = 'mb-1.5 text-sm font-medium text-secondary';
const HINT = 'mt-1 text-xs text-muted';

/** The owners checkbox's N while the filter is off (the retired chip's default). */
export const DEFAULT_OWNERS_MIN = 2;

const ANY_PLAYERS = 'any';

const PLAYER_OPTIONS = [
    { value: ANY_PLAYERS, label: 'Any' },
    ...PLAYER_COUNT_PRESETS.map((p) => ({ value: p.key as string, label: p.label as string })),
];

/**
 * A native fieldset: `disabled` disables every control inside it. The primitives dim
 * themselves (form-classes DISABLED), so only the legend is dimmed here — never the
 * whole group, which would stack a second opacity on the controls.
 */
export function FilterFieldGroup({ legend, disabled = false, testId, children }: {
    legend: string; disabled?: boolean; testId?: string; children: ReactNode;
}): JSX.Element {
    return (
        <fieldset disabled={disabled} data-testid={testId} className="min-w-0">
            <legend className={`${LEGEND} ${disabled ? 'opacity-50' : ''}`.trim()}>{legend}</legend>
            {children}
        </fieldset>
    );
}

/** `lfg=1` as a switch. Never disabled: it is the way back out of the LFG view. */
export function LfgField({ isLfgOnly, onToggle }: { isLfgOnly: boolean; onToggle: () => void }): JSX.Element {
    return (
        <FilterFieldGroup legend="Looking for group">
            <div className="flex items-center justify-between gap-3 min-h-[44px]">
                <span className="text-base lg:text-sm font-medium text-foreground">Players are looking</span>
                <Switch checked={isLfgOnly} onChange={onToggle} label="Players are looking" testId="lfg-filter-switch" />
            </div>
            <p className={HINT}>Shows open LFG groups instead of the library; the filters below pause while it is on.</p>
        </FilterFieldGroup>
    );
}

/** The 2 / 3 / 4 / 5+ presets as a segmented radio group; "Any" drops `players`. */
export function PlayersField({ filters, disabled }: { filters: LibraryFilterParams; disabled: boolean }): JSX.Element {
    return (
        // No wrapper opacity: the segments dim themselves while disabled.
        <RadioGroup
            label="Players" appearance="segmented" options={PLAYER_OPTIONS} disabled={disabled}
            value={filters.playersFilter ?? ANY_PLAYERS}
            onChange={(v) => filters.setPlayersFilter(v === ANY_PLAYERS ? null : v)}
        />
    );
}

/** "Owned by N+ members" — today's single toggle: N is whatever `owners` holds, else 2. */
export function OwnersField({ filters, disabled }: { filters: LibraryFilterParams; disabled: boolean }): JSX.Element {
    const target = filters.minOwners ?? DEFAULT_OWNERS_MIN;
    return (
        <FilterFieldGroup legend="Owners" disabled={disabled}>
            <Checkbox
                label={`Owned by ${target}+ members`} checked={filters.minOwners !== null}
                onChange={() => filters.toggleMinOwners(target)} data-testid="owners-filter-checkbox"
            />
        </FilterFieldGroup>
    );
}

/** Which kinds of missing data are currently costing a game its place. */
function libraryHintText(hasPlayers: boolean, hasOwners: boolean): string {
    const parts: string[] = [];
    if (hasPlayers) parts.push('player-count');
    if (hasOwners) parts.push('ownership');
    return `Showing only games with ${parts.join(' and ')} data`;
}

/** NULL-semantics disclosure: a game with no IGDB range / owner aggregate is hidden, so say so. */
export function LibraryFilterHint({ filters }: { filters: LibraryFilterParams }): JSX.Element | null {
    if (!filters.isLibraryFiltered) return null;
    return (
        <p data-testid="library-filter-hint" className={HINT}>
            {libraryHintText(filters.playersFilter !== null, filters.minOwners !== null)}
        </p>
    );
}

function toggleGenre(selected: Set<string>, key: string): Set<string> {
    return new Set(selected.has(key) ? [...selected].filter((k) => k !== key) : [...selected, key]);
}

/** Genre checkboxes. Search results skip genres, so the group turns off (with a hint) while searching. */
export function GenresField({ selectedGenres, onGenresChange, disabled, isSearching }: {
    selectedGenres: Set<string>; onGenresChange: (next: Set<string>) => void; disabled: boolean; isSearching: boolean;
}): JSX.Element {
    return (
        <FilterFieldGroup legend="Genres" disabled={disabled || isSearching} testId="genre-filter-group">
            {isSearching && (
                <p data-testid="genre-search-hint" className="mb-2 text-xs text-muted">
                    Search results skip genres, so this group turns off while a search is active.
                </p>
            )}
            <div className="grid grid-cols-2 gap-x-4">
                {GENRE_FILTERS.map((genre) => (
                    <Checkbox
                        key={genre.key} label={genre.label} checked={selectedGenres.has(genre.key)}
                        onChange={() => onGenresChange(toggleGenre(selectedGenres, genre.key))}
                    />
                ))}
            </div>
        </FilterFieldGroup>
    );
}
