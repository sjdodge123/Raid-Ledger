/**
 * Play history dropdown for player filters (ROK-821).
 * Options: Any / Played Recently / Played Ever.
 */
import type { JSX } from 'react';

const PLAY_HISTORY_OPTIONS = [
    { value: '', label: 'Any' },
    { value: 'played_recently', label: 'Played Recently (2 weeks)' },
    { value: 'played_ever', label: 'Played Ever' },
] as const;

interface PlayHistorySelectProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

/** Play history dropdown filter. Disabled when no game is selected (requires game_interests join). */
export function PlayHistorySelect({ value, onChange, disabled }: PlayHistorySelectProps): JSX.Element {
    return (
        <label className={`flex flex-col gap-1.5 ${disabled ? 'opacity-50' : ''}`}>
            <span className="text-xs font-medium text-muted">Play History</span>
            <select
                aria-label="Play History"
                value={disabled ? '' : value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                title={disabled ? 'Select a game first' : undefined}
                className="px-2 py-1.5 bg-surface border border-edge rounded text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed"
            >
                {PLAY_HISTORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </label>
    );
}
