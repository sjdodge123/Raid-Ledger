/**
 * Source multi-select checkbox group for player filters (ROK-821).
 * All unchecked = default behavior (no source filter applied).
 */
import type { JSX } from 'react';

const SOURCE_OPTIONS = [
    { value: 'manual', label: 'Manual' },
    { value: 'discord', label: 'Discord' },
    { value: 'steam_library', label: 'Steam Library' },
    { value: 'steam_wishlist', label: 'Steam Wishlist' },
] as const;

interface SourceMultiSelectProps {
    selectedSources: string[];
    onChange: (sources: string[]) => void;
}

/** Checkbox group for source filtering. */
export function SourceMultiSelect({ selectedSources, onChange }: SourceMultiSelectProps): JSX.Element {
    const handleToggle = (source: string): void => {
        const isSelected = selectedSources.includes(source);
        const next = isSelected
            ? selectedSources.filter((s) => s !== source)
            : [...selectedSources, source];
        onChange(next);
    };

    return (
        <fieldset>
            <legend className="text-xs font-medium text-muted mb-2">Sources</legend>
            <div className="flex flex-wrap gap-3">
                {SOURCE_OPTIONS.map((opt) => (
                    <SourceCheckbox
                        key={opt.value}
                        label={opt.label}
                        checked={selectedSources.includes(opt.value)}
                        onChange={() => handleToggle(opt.value)}
                    />
                ))}
            </div>
        </fieldset>
    );
}

/** Single source checkbox item. */
function SourceCheckbox({ label, checked, onChange }: {
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
