/**
 * ROK-1402 — co-op filter controls rendered as `FilterPanel` children on the
 * games library page (Players-page precedent: inline on desktop, BottomSheet on
 * mobile). "Min online players" slider + four mode toggles.
 */
import type { JSX } from 'react';
import type { CoopFilterState } from './coop-filter.helpers';

type ToggleKey = 'couchCoop' | 'lanCoop' | 'splitscreen' | 'campaignCoop';

/** Highest value the slider offers; 0 means "Any" (predicate inactive). */
const MAX_ONLINE_PLAYERS = 16;

// Mirrors the Common Ground slider sizing (ROK-1297 round 5m): 44px tap target,
// full-width track, emerald thumb. Kept as a local copy rather than an import so
// this page never reaches into the lineups module.
const SLIDER_CLS =
    'flex-1 h-11 accent-emerald-500 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5';

const COOP_TOGGLES: { key: ToggleKey; label: string }[] = [
    { key: 'couchCoop', label: 'Couch co-op' },
    { key: 'lanCoop', label: 'LAN co-op' },
    { key: 'splitscreen', label: 'Split-screen' },
    { key: 'campaignCoop', label: 'Co-op campaign' },
];

interface CoopFilterControlsProps {
    state: CoopFilterState;
    onChange: (next: CoopFilterState) => void;
    /** Co-Optimus-only toggles hide until enrichment data exists (see `hasAnyCoopData`). */
    showModeToggles: boolean;
}

/** Panel body: online-player minimum plus the co-op mode toggles. */
export function CoopFilterControls({ state, onChange, showModeToggles }: CoopFilterControlsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MinOnlinePlayersSlider
                value={state.onlineMinPlayers}
                onChange={(onlineMinPlayers) => onChange({ ...state, onlineMinPlayers })}
            />
            {showModeToggles && (
            <fieldset>
                <legend className="text-xs font-medium text-muted mb-2">Co-op modes</legend>
                <div className="flex flex-wrap gap-3">
                    {COOP_TOGGLES.map((toggle) => (
                        <CoopToggle
                            key={toggle.key}
                            label={toggle.label}
                            checked={state[toggle.key] === true}
                            onChange={() => onChange({ ...state, [toggle.key]: state[toggle.key] !== true })}
                        />
                    ))}
                </div>
            </fieldset>
            )}
        </div>
    );
}

/** Minimum online co-op players. 0 reads as "Any" and clears the predicate. */
function MinOnlinePlayersSlider({ value, onChange }: {
    value: number | undefined;
    onChange: (value: number | undefined) => void;
}): JSX.Element {
    const current = value ?? 0;
    return (
        <label className="flex items-center gap-3 text-base text-foreground min-h-[44px]">
            <span className="whitespace-nowrap font-medium">Online</span>
            <input
                type="range"
                aria-label="Min online players"
                min={0}
                max={MAX_ONLINE_PLAYERS}
                value={current}
                onChange={(e) => {
                    const next = Number(e.target.value);
                    onChange(next > 0 ? next : undefined);
                }}
                className={SLIDER_CLS}
            />
            <span className="text-sm font-mono w-8 text-right text-foreground">
                {current || 'Any'}
            </span>
        </label>
    );
}

/** Single co-op mode checkbox. */
function CoopToggle({ label, checked, onChange }: {
    label: string;
    checked: boolean;
    onChange: () => void;
}): JSX.Element {
    return (
        <label className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="rounded border-edge text-emerald-500 focus:ring-emerald-500"
            />
            {label}
        </label>
    );
}
