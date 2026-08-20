/**
 * Filter controls for the Common Ground panel (ROK-934).
 * Min owners slider, genre dropdown, max players input.
 */
import { type JSX, useCallback, useEffect, useRef } from 'react';
import type { CommonGroundParams } from '../../lib/api-client';

interface Props {
    filters: CommonGroundParams;
    onChange: (next: CommonGroundParams) => void;
    search: string;
    onSearchChange: (v: string) => void;
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

// ROK-1297 round 5m: mobile-compliant control sizing.
//  - 44px min-height tap targets (Apple HIG / Material / WCAG 2.5.5)
//  - text-base (16px) on inputs prevents iOS Safari auto-zoom on focus
//  - Foreground label color (was text-muted, hard to read)
//  - Full-width sliders so the track is comfortably tappable
const SLIDER_CLS =
    'flex-1 h-11 accent-emerald-500 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5';

/** Slider for the minimum owners threshold (0–15). */
function MinOwnersSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (v: number) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-3 text-base text-foreground min-h-[44px]">
            <span className="whitespace-nowrap font-medium">Min owners</span>
            <input
                type="range"
                min={0}
                max={15}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className={SLIDER_CLS}
            />
            <span className="text-sm font-mono w-6 text-right text-foreground">
                {value}
            </span>
        </label>
    );
}

/** Free-text game name search. */
function SearchBox({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search games..."
            aria-label="Search games"
            className="min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground placeholder:text-dim w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
    );
}

/** Slider for filtering by player count. */
function PlayersSlider({
    value,
    onChange,
}: {
    value: number | undefined;
    onChange: (v: number | undefined) => void;
}): JSX.Element {
    const current = value ?? 0;
    return (
        <label className="flex items-center gap-3 text-base text-foreground min-h-[44px]">
            <span className="whitespace-nowrap font-medium">Players</span>
            <input
                type="range"
                min={0}
                max={16}
                value={current}
                onChange={(e) => {
                    const v = Number(e.target.value);
                    onChange(v === 0 ? undefined : v);
                }}
                className={SLIDER_CLS}
            />
            <span className="text-sm font-mono w-8 text-right text-foreground">
                {current || 'Any'}
            </span>
        </label>
    );
}

/**
 * Slider for the co-op group size (ROK-1400). Styled to match the Min
 * owners / Players sliders above — operator review 2026-08-20 asked for a
 * slider rather than a number box so the whole panel reads as one control
 * family. Minimum is 1 because the API schema rejects 0.
 */
function CoopSizeSlider({
    value,
    onChange,
}: {
    value: number;
    onChange: (v: number) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-3 text-base text-foreground min-h-[44px]">
            <span className="whitespace-nowrap font-medium">Co-op group size</span>
            <input
                type="range"
                min={1}
                max={16}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className={SLIDER_CLS}
            />
            <span className="text-sm font-mono w-6 text-right text-foreground">
                {value}
            </span>
        </label>
    );
}

/**
 * ROK-1400 co-op group-size filter — opt-in toggle plus the size entry.
 * Switching ON seeds the size from `participantCount` (min 1); switching
 * OFF clears it so the server-side filter goes away entirely. While the
 * filter is active, games with no co-op data at all are excluded by the
 * API, so we say so rather than letting them vanish silently.
 */
function CoopToggle({
    active,
    onToggle,
}: {
    active: boolean;
    onToggle: (on: boolean) => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-2 text-base text-foreground min-h-[44px]">
            <input
                type="checkbox"
                checked={active}
                onChange={(e) => onToggle(e.target.checked)}
                className="w-5 h-5 accent-emerald-500"
            />
            <span className="whitespace-nowrap font-medium">
                Co-op for our group size
            </span>
        </label>
    );
}

/** Opt-in co-op group-size filter: toggle, size entry, NULL-data hint. */
function CoopGroupSizeFilter({
    value,
    participantCount,
    onChange,
}: {
    value: number | undefined;
    participantCount: number | undefined;
    onChange: (v: number | undefined) => void;
}): JSX.Element {
    const active = value != null;
    return (
        <div className="flex flex-col gap-1">
            <CoopToggle
                active={active}
                onToggle={(on) =>
                    onChange(on ? Math.max(1, participantCount ?? 1) : undefined)
                }
            />
            {active && (
                <>
                    <CoopSizeSlider value={value} onChange={onChange} />
                    <span className="text-xs text-muted">
                        Only showing games with co-op data
                    </span>
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

/** Filter bar for the Common Ground panel. */
export function CommonGroundFilters({ filters, onChange, search, onSearchChange, participantCount, suppressAutoSeed, coopDataAvailable }: Props): JSX.Element {
    const update = useCallback(
        (patch: Partial<CommonGroundParams>) => onChange({ ...filters, ...patch }),
        [filters, onChange],
    );
    useMaxPlayersIntentCapture(participantCount, filters, onChange, suppressAutoSeed);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:[grid-template-columns:repeat(3,minmax(220px,1fr))] gap-3 sm:gap-4 items-center">
            <SearchBox value={search} onChange={onSearchChange} />
            <MinOwnersSlider
                value={filters.minOwners ?? 2}
                onChange={(v) => update({ minOwners: v })}
            />
            <PlayersSlider
                value={filters.maxPlayers}
                onChange={(v) => update({ maxPlayers: v })}
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
