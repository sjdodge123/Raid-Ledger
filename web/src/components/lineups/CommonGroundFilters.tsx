/**
 * Filter controls for the Common Ground panel (ROK-934, ROK-1659).
 *
 * `CommonGroundFilters` is the panel BODY — min owners, players and the
 * opt-in co-op group size, built from the shared `Slider` / `Checkbox`
 * primitives. `CommonGroundFilterEntry` puts that body behind the shared
 * funnel filter standard (`FilterEntry`): the inline panel at 1024px and up,
 * the Filters FAB + BottomSheet below. Search is NOT a filter here — it lives
 * in the page toolbar next to the funnel (`FilterEntryTrigger`).
 */
import { type JSX, useCallback, useEffect, useRef } from 'react';
import type { CommonGroundParams } from '../../lib/api-client';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { FilterEntry } from '../ui/filter-entry';
import { commonGroundActiveFilterCount } from './common-ground-filter-count';

export interface CommonGroundFiltersProps {
    filters: CommonGroundParams;
    onChange: (next: CommonGroundParams) => void;
    /**
     * Voting-eligibility size for the active lineup (ROK-1255). When > 0
     * and `filters.maxPlayers` is unset, the player-count slider auto-sets
     * to this value on first mount so a 3-person group sees 3-player-
     * compatible games immediately. Manual adjustments are preserved.
     */
    participantCount?: number;
    /**
     * ROK-1400: skip the ROK-1255 one-shot auto-seed because the filters were
     * restored from a previous visit. Without this, returning to the panel
     * re-pins `maxPlayers` and silently undoes a deliberate "Any" choice.
     */
    suppressAutoSeed?: boolean;
    /**
     * ROK-1400: whether ANY game has been Co-Optimus-synced yet
     * (`meta.coopDataAvailable`). The co-op filter is Co-Optimus-verified
     * only, so until a sync has run it could only ever return zero rows —
     * the entire control stays dormant (unrendered) rather than offering a
     * toggle that empties the grid. Absent = not available.
     */
    coopDataAvailable?: boolean;
}

/** Players readout: 0 on the track means "no player-count filter". */
const formatPlayers = (v: number): string => (v === 0 ? 'Any' : String(v));

/**
 * ROK-1400 co-op group-size filter — opt-in toggle plus the size slider.
 * Switching ON seeds the size from `participantCount` (min 1); switching
 * OFF clears it so the server-side filter goes away entirely. While the
 * filter is active, games with no co-op data at all are excluded by the
 * API, so we say so rather than letting them vanish silently. The slider
 * minimum is 1 because the API schema rejects 0.
 */
function CoopGroupSizeFilter({ value, participantCount, onChange }: {
    value: number | undefined;
    participantCount: number | undefined;
    onChange: (v: number | undefined) => void;
}): JSX.Element {
    const active = value != null;
    return (
        <div className="flex flex-col">
            <Checkbox
                label="Co-op for our group size"
                checked={active}
                onChange={(e) => onChange(e.target.checked ? Math.max(1, participantCount ?? 1) : undefined)}
            />
            {active && (
                <>
                    <Slider label="Co-op group size" min={1} max={16} value={value} onChange={onChange} />
                    <p className="text-xs text-muted">Only showing games with co-op data</p>
                </>
            )}
        </div>
    );
}

/**
 * ROK-1255: pre-set the player-count filter to the lineup's participant
 * count the FIRST time we see a known value (>0). Captures intent on entry
 * to the nomination panel without re-pinning when invitees join or leave
 * mid-building, and without overriding manual adjustments.
 */
function useMaxPlayersIntentCapture(
    participantCount: number | undefined,
    filters: CommonGroundParams,
    onChange: (next: CommonGroundParams) => void,
    suppressAutoSeed = false,
): void {
    const intentCapturedRef = useRef(false);
    useEffect(() => {
        if (intentCapturedRef.current) return;
        // ROK-1400: restored filters are an explicit prior choice, not a
        // first visit — never overwrite them with the seed.
        if (suppressAutoSeed) return;
        // ROK-1348: a brand-new lineup has participantCount === 1 (creator
        // only). Auto-pinning maxPlayers to 1 would filter out every
        // multiplayer game, which is pathological for a co-op nomination
        // panel. Treat <= 1 as "no auto-set" so the slider stays open until
        // there are at least 2 eligible players.
        if (!participantCount || participantCount <= 1) return;
        intentCapturedRef.current = true;
        if (filters.maxPlayers != null) return;
        onChange({ ...filters, maxPlayers: participantCount });
    }, [participantCount, filters, onChange, suppressAutoSeed]);
}

/**
 * The filter body for the Common Ground panel. Stays mounted while the panel
 * is collapsed (the inline panel and the BottomSheet both keep children in
 * the DOM), so the ROK-1255 auto-seed runs on entry at every width.
 */
export function CommonGroundFilters({ filters, onChange, participantCount, suppressAutoSeed, coopDataAvailable }: CommonGroundFiltersProps): JSX.Element {
    const update = useCallback(
        (patch: Partial<CommonGroundParams>) => onChange({ ...filters, ...patch }),
        [filters, onChange],
    );
    useMaxPlayersIntentCapture(participantCount, filters, onChange, suppressAutoSeed);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-8 items-start">
            <Slider label="Min owners" min={0} max={15} value={filters.minOwners ?? 2} onChange={(v) => update({ minOwners: v })} />
            <Slider
                label="Players" min={0} max={16} value={filters.maxPlayers ?? 0} formatValue={formatPlayers}
                onChange={(v) => update({ maxPlayers: v === 0 ? undefined : v })}
            />
            {/* Dormant until the catalogue has Co-Optimus data — see Props. */}
            {coopDataAvailable && (
                <CoopGroupSizeFilter
                    value={filters.minOnlineCoop}
                    participantCount={participantCount}
                    onChange={(v) => update({ minOnlineCoop: v })}
                />
            )}
        </div>
    );
}

export interface CommonGroundFilterEntryProps extends CommonGroundFiltersProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * ROK-1659: the Common Ground filter set behind the shared funnel standard.
 * Pair it with a `FilterEntryTrigger` (same `activeCount` / `isOpen`) in the
 * toolbar. "Clear all" clears exactly what the badge counts — the co-op
 * filter — and leaves the min-owners / player-count defaults alone.
 */
export function CommonGroundFilterEntry({ isOpen, onOpenChange, ...body }: CommonGroundFilterEntryProps): JSX.Element {
    const { filters, onChange, coopDataAvailable } = body;
    return (
        <FilterEntry
            activeCount={commonGroundActiveFilterCount(filters, coopDataAvailable)}
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            onClearAll={() => onChange({ ...filters, minOnlineCoop: undefined })}
        >
            <CommonGroundFilters {...body} />
        </FilterEntry>
    );
}
