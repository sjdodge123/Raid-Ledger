/**
 * ROK-1402 — co-op filter controls rendered as `FilterPanel` children on the
 * games library page (Players-page precedent: inline on desktop, BottomSheet on
 * mobile). An "Online co-op" `Slider` + four mode `Checkbox`es (ROK-1650: the
 * visible label is the accessible name — ruling 12).
 */
import type { JSX } from 'react';
import { Checkbox } from '../../components/ui/checkbox';
import { Slider } from '../../components/ui/slider';
import type { CoopFilterState } from './coop-filter.helpers';

type ToggleKey = 'couchCoop' | 'lanCoop' | 'splitscreen' | 'campaignCoop';

/** Highest value the slider offers; 0 means "Any" (predicate inactive). */
const MAX_ONLINE_PLAYERS = 16;

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

/**
 * Panel body: online-player minimum plus the co-op mode toggles. The whole
 * section is gated on co-op data existing (see `hasAnyCoopData`), so by the time
 * this renders every control has data to match against.
 */
export function CoopFilterControls({ state, onChange }: CoopFilterControlsProps): JSX.Element {
    return (
        <div className="flex flex-col gap-4">
            <MinOnlinePlayersSlider
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

/** Minimum online co-op players. 0 reads as "Any" and clears the predicate. */
function MinOnlinePlayersSlider({ value, onChange }: {
    value: number | undefined;
    onChange: (value: number | undefined) => void;
}): JSX.Element {
    return (
        <Slider
            label="Online co-op"
            min={0}
            max={MAX_ONLINE_PLAYERS}
            value={value ?? 0}
            onChange={(next) => onChange(next > 0 ? next : undefined)}
            formatValue={(v) => (v ? String(v) : 'Any')}
        />
    );
}

/** Single co-op mode checkbox: the visible label row is the 44px target. */
function CoopToggle({ label, checked, onChange }: {
    label: string;
    checked: boolean;
    onChange: () => void;
}): JSX.Element {
    return <Checkbox label={label} checked={checked} onChange={onChange} />;
}
