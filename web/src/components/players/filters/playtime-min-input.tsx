/**
 * Minimum playtime input for player filters (ROK-821).
 * Accepts hours, converts to minutes for URL/API.
 */
import type { JSX } from 'react';

interface PlaytimeMinInputProps {
    value?: number;
    onChange: (value: number | undefined) => void;
}

/** Number input for minimum playtime hours. */
export function PlaytimeMinInput({ value, onChange }: PlaytimeMinInputProps): JSX.Element {
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
        <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Min Hours</span>
            <input
                type="number"
                aria-label="Min Hours"
                min={0}
                value={displayValue}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="0"
                className="w-24 px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
        </label>
    );
}
