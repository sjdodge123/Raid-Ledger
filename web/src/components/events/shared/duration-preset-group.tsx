/**
 * DurationPresetGroup — the event duration picker (ROK-1649, forms ruling 6).
 *
 * - A segmented `RadioGroup` labelled 'Duration': one segment per preset plus
 *   'Custom'. Value is the preset's minutes, or `'custom'`.
 * - `presets` is a prop because two preset lists exist
 *   (`shared/event-form-constants.ts` and `reschedule-utils.ts`).
 * - No asterisk (ruling 8): the group always holds a value.
 * - `error` renders under the group as `role="alert"` in the danger token.
 */
import type { JSX } from 'react';
import { RadioGroup } from '../../ui/radio-group';

export interface DurationPreset {
    label: string;
    minutes: number;
}

/** A preset's minutes, or the Custom segment. */
export type DurationChoice = number | 'custom';

export interface DurationPresetGroupProps {
    presets: readonly DurationPreset[];
    value: DurationChoice;
    onChange: (value: DurationChoice) => void;
    error?: string;
    label?: string;
    className?: string;
}

const CUSTOM = 'custom';

/** Segmented duration picker. See the file header for the contract. */
export function DurationPresetGroup({
    presets, value, onChange, error, label = 'Duration', className,
}: DurationPresetGroupProps): JSX.Element {
    const options = [
        ...presets.map((p) => ({ value: String(p.minutes), label: p.label })),
        { value: CUSTOM, label: 'Custom' },
    ];
    return (
        <RadioGroup
            label={label} appearance="segmented" options={options} value={String(value)}
            onChange={(v) => onChange(v === CUSTOM ? CUSTOM : Number(v))}
            error={error} className={className}
        />
    );
}
