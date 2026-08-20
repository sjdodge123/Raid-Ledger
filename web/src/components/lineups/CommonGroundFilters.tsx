/**
 * Filter controls for the Common Ground panel (ROK-934).
 * Min owners slider, genre dropdown, max players input.
 */
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';
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
 * Number entry for the co-op group size (ROK-1400). Keeps its own text
 * state so clearing the box doesn't fight the controlled `value` prop —
 * an empty box simply emits nothing and leaves the active filter alone
 * until a real number is typed.
 */
function CoopSizeInput({
    value,
    onChange,
}: {
    value: number;
    onChange: (v: number) => void;
}): JSX.Element {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    return (
        <label className="flex items-center gap-2 text-sm text-foreground">
            <span className="whitespace-nowrap">Co-op group size</span>
            <input
                type="number"
                min={1}
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    const parsed = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed) && parsed >= 1) onChange(parsed);
                }}
                className="min-h-[44px] w-20 bg-panel border border-edge rounded-md px-2 py-1 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
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
            <label className="flex items-center gap-2 text-base text-foreground min-h-[44px]">
                <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) =>
                        onChange(
                            e.target.checked
                                ? Math.max(1, participantCount ?? 1)
                                : undefined,
                        )
                    }
                    className="w-5 h-5 accent-emerald-500"
                />
                <span className="whitespace-nowrap font-medium">
                    Co-op for our group size
                </span>
            </label>
            {active && (
                <>
                    <CoopSizeInput value={value} onChange={onChange} />
                    <span className="text-xs text-muted">
                        Only showing games with co-op data
                    </span>
                </>
            )}
        </div>
    );
}

/** Filter bar for the Common Ground panel. */
export function CommonGroundFilters({ filters, onChange, search, onSearchChange, participantCount }: Props): JSX.Element {
    const update = useCallback(
        (patch: Partial<CommonGroundParams>) => onChange({ ...filters, ...patch }),
        [filters, onChange],
    );

    // ROK-1255: pre-set the player-count filter to the lineup's participant
    // count the FIRST time we see a known value (>0). Captures intent on
    // entry to the nomination panel without re-pinning when invitees join
    // or leave mid-building, and without overriding manual adjustments.
    const intentCapturedRef = useRef(false);
    useEffect(() => {
        if (intentCapturedRef.current) return;
        // ROK-1348: a brand-new lineup has participantCount === 1 (creator
        // only). Auto-pinning maxPlayers to 1 would filter out every
        // multiplayer game, which is pathological for a co-op nomination
        // panel. Treat <= 1 as "no auto-set" so the slider stays open until
        // there are at least 2 eligible players.
        if (!participantCount || participantCount <= 1) return;
        intentCapturedRef.current = true;
        if (filters.maxPlayers != null) return;
        onChange({ ...filters, maxPlayers: participantCount });
    }, [participantCount, filters, onChange]);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:[grid-template-columns:repeat(3,minmax(220px,1fr))] gap-3 sm:gap-4 items-center">
            <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search games..."
                aria-label="Search games"
                className="min-h-[44px] bg-panel border border-edge rounded-md px-3 py-2 text-base text-foreground placeholder:text-dim w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <MinOwnersSlider
                value={filters.minOwners ?? 2}
                onChange={(v) => update({ minOwners: v })}
            />
            <PlayersSlider
                value={filters.maxPlayers}
                onChange={(v) => update({ maxPlayers: v })}
            />
            <CoopGroupSizeFilter
                value={filters.minOnlineCoop}
                participantCount={participantCount}
                onChange={(v) => update({ minOnlineCoop: v })}
            />
        </div>
    );
}
