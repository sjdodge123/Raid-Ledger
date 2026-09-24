/**
 * Minimum playtime input for player filters (ROK-821; ROK-1651 moved it onto Field + Input).
 * Accepts hours, converts to minutes for URL/API.
 */
import type { JSX } from 'react';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';

interface PlaytimeMinInputProps {
    value?: number;
    onChange: (value: number | undefined) => void;
    disabled?: boolean;
}

/** Number input for minimum playtime hours. Disabled (with a visible hint) when no game is selected. */
export function PlaytimeMinInput({ value, onChange, disabled }: PlaytimeMinInputProps): JSX.Element {
    const displayValue = value ? String(Math.round(value / 60)) : '';

    const handleChange = (rawValue: string): void => {
        const hours = parseInt(rawValue, 10);
        if (Number.isFinite(hours) && hours > 0) {
            onChange(hours * 60);
        } else {
            onChange(undefined);
        }
    };

    return (
        <Field label="Min hours" hint={disabled ? 'Select a game first' : undefined}>
            <div className="w-24">
                <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={disabled ? '' : displayValue}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled}
                    placeholder="0"
                />
            </div>
        </Field>
    );
}
