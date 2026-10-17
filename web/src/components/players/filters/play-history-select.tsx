/**
 * Play history dropdown for player filters (ROK-821; ROK-1651 moved it onto Field + Select).
 * Options: Any / Played recently / Played ever.
 */
import type { JSX } from 'react';
import { Field } from '../../ui/field';
import { Select } from '../../ui/select';

const PLAY_HISTORY_OPTIONS = [
    { value: '', label: 'Any' },
    { value: 'played_recently', label: 'Played recently (2 weeks)' },
    { value: 'played_ever', label: 'Played ever' },
] as const;

interface PlayHistorySelectProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

/**
 * Play history dropdown filter. Disabled when no game is selected (requires the
 * game_interests join); the reason is a visible Field hint, not a tooltip.
 */
export function PlayHistorySelect({ value, onChange, disabled }: PlayHistorySelectProps): JSX.Element {
    return (
        <Field label="Play history" hint={disabled ? 'Select a game first' : undefined}>
            <Select value={disabled ? '' : value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
                {PLAY_HISTORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </Select>
        </Field>
    );
}
