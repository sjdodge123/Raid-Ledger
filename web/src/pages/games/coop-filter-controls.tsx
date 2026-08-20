/**
 * ROK-1402 — co-op filter controls rendered as `FilterPanel` children on the
 * games library page (Players-page precedent: inline on desktop, BottomSheet on
 * mobile). Numeric "minimum online players" input + four mode toggles.
 */
import type { JSX } from 'react';
import type { CoopFilterState } from './coop-filter.helpers';

type ToggleKey = 'couchCoop' | 'lanCoop' | 'splitscreen' | 'campaignCoop';

const COOP_TOGGLES: { key: ToggleKey; label: string }[] = [
    { key: 'couchCoop', label: 'Couch co-op' },
    { key: 'lanCoop', label: 'LAN co-op' },
    { key: 'splitscreen', label: 'Split-screen' },
    { key: 'campaignCoop', label: 'Co-op campaign' },
];

interface CoopFilterControlsProps {
    state: CoopFilterState;
    onChange: (next: CoopFilterState) => void;
}

/** Panel body: online-player minimum plus the co-op mode toggles. */
export function CoopFilterControls({ state, onChange }: CoopFilterControlsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MinOnlinePlayersInput
                value={state.onlineMinPlayers}
                onChange={(onlineMinPlayers) => onChange({ ...state, onlineMinPlayers })}
            />
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
        </div>
    );
}

/** Minimum online co-op players. Empty/0/invalid clears the predicate. */
function MinOnlinePlayersInput({ value, onChange }: {
    value: number | undefined;
    onChange: (value: number | undefined) => void;
}): JSX.Element {
    const handleChange = (raw: string): void => {
        const parsed = parseInt(raw, 10);
        onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
    };

    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Online co-op players</span>
            <input
                type="number"
                aria-label="Min online players"
                min={0}
                value={value ? String(value) : ''}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Any"
                className="w-24 px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
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
