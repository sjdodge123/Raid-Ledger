/**
 * Source multi-select checkbox group for player filters (ROK-821; ROK-1651 moved
 * the rows onto Checkbox and the legend onto the Field label typography).
 * All unchecked = default behavior (no source filter applied).
 */
import type { JSX } from 'react';
import { Checkbox } from '../../ui/checkbox';

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

const ALL_SOURCE_VALUES = SOURCE_OPTIONS.map((o) => o.value);

/** Checkbox group for source filtering. Empty = all selected (no filter). */
export function SourceMultiSelect({ selectedSources, onChange }: SourceMultiSelectProps): JSX.Element {
    const effectiveSources = selectedSources.length > 0 ? selectedSources : ALL_SOURCE_VALUES;

    const handleToggle = (source: string): void => {
        const isSelected = effectiveSources.includes(source);
        const next = isSelected
            ? effectiveSources.filter((s) => s !== source)
            : [...effectiveSources, source];
        const allSelected = next.length === ALL_SOURCE_VALUES.length;
        onChange(allSelected ? [] : next);
    };

    return (
        <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-secondary">Sources</legend>
            <div className="flex flex-wrap gap-x-5">
                {SOURCE_OPTIONS.map((opt) => (
                    <Checkbox
                        key={opt.value}
                        label={opt.label}
                        checked={effectiveSources.includes(opt.value)}
                        onChange={() => handleToggle(opt.value)}
                    />
                ))}
            </div>
        </fieldset>
    );
}
