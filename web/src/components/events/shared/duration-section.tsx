import type { JSX } from 'react';
import { Input } from '../../ui/input';
import { DURATION_PRESETS } from './event-form-constants';
import { DurationPresetGroup, type DurationChoice } from './duration-preset-group';

export interface DurationSectionProps {
    durationMinutes: number;
    customDuration: boolean;
    durationError?: string;
    onDurationMinutesChange: (v: number) => void;
    onCustomDurationChange: (v: boolean) => void;
    onDurationErrorClear?: () => void;
}

function clamp(raw: string, max: number): number {
    return Math.max(0, Math.min(max, parseInt(raw) || 0));
}

/** One number field of the custom duration (hours or minutes) with its unit. */
function DurationPart({ label, unit, value, max, step, onChange }: {
    label: string; unit: string; value: number; max: number; step?: number; onChange: (v: number) => void;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            <Input
                type="number" inputMode="numeric" aria-label={label} min={0} max={max} step={step} value={value}
                onChange={(e) => onChange(clamp(e.target.value, max))} className="sm:w-20 text-center"
            />
            <span className="text-sm text-muted shrink-0">{unit}</span>
        </div>
    );
}

function CustomDurationFields({ durationMinutes, onChange }: {
    durationMinutes: number; onChange: (v: number) => void;
}): JSX.Element {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return (
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
            <DurationPart label="Duration hours" unit="hr" value={hours} max={24} onChange={(h) => onChange(h * 60 + minutes)} />
            <DurationPart label="Duration minutes" unit="min" value={minutes} max={59} step={5} onChange={(m) => onChange(hours * 60 + m)} />
        </div>
    );
}

export function DurationSection({
    durationMinutes, customDuration, durationError, onDurationMinutesChange, onCustomDurationChange, onDurationErrorClear,
}: DurationSectionProps): JSX.Element {
    const choose = (choice: DurationChoice) => {
        if (choice === 'custom') { onCustomDurationChange(true); return; }
        onDurationMinutesChange(choice);
        onCustomDurationChange(false);
        onDurationErrorClear?.();
    };
    return (
        <div className="space-y-3">
            <DurationPresetGroup
                presets={DURATION_PRESETS} value={customDuration ? 'custom' : durationMinutes}
                onChange={choose} error={durationError}
            />
            {customDuration && (
                <CustomDurationFields
                    durationMinutes={durationMinutes}
                    onChange={(v) => { onDurationMinutesChange(v); onDurationErrorClear?.(); }}
                />
            )}
        </div>
    );
}
