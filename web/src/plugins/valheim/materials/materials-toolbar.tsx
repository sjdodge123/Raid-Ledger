/**
 * ROK-1853 — the Materials toolbar: `SearchInput` (name or prefab) plus the
 * §4.1 funnel (`FilterEntry`): a category `Select` and the "Include carts and
 * ships" `Switch` (D10). Toolbar trigger + inline panel at ≥1024px; the
 * neutral Filters FAB + `BottomSheet` below. ROK-1859: a "Base" `Select`
 * first, shown once the server sends at least one base.
 */
import { useState, type JSX } from 'react';
import type { ValheimMaterialsBase } from '@raid-ledger/contract';
import {
    FilterEntry,
    FilterEntryTrigger,
} from '../../../components/ui/filter-entry';
import { SearchInput } from '../../../components/ui/search-input';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { baseOptionLabel } from './materials-bases.helpers';
import type { MaterialsFilters } from './materials.helpers';

interface ToolbarProps {
    filters: MaterialsFilters;
    categories: readonly string[];
    onChange: (next: MaterialsFilters) => void;
    /** ROK-1859: the scan's bases (empty when none or not sent). */
    bases: readonly ValheimMaterialsBase[];
    /** The selected base key, or null for All bases. */
    base: string | null;
    onBase: (key: string | null) => void;
}

const activeCountOf = (f: MaterialsFilters, base: string | null): number =>
    (f.category === null ? 0 : 1) +
    (f.includeVehicles ? 0 : 1) +
    (base === null ? 0 : 1);

function BaseSelect({
    bases,
    base,
    onBase,
}: Pick<ToolbarProps, 'bases' | 'base' | 'onBase'>): JSX.Element | null {
    if (bases.length === 0) return null;
    return (
        <Select
            aria-label="Base"
            placeholder="All bases"
            value={base ?? ''}
            onChange={(e) => onBase(e.target.value === '' ? null : e.target.value)}
        >
            {bases.map((b) => (
                <option key={b.key} value={b.key}>
                    {baseOptionLabel(b)}
                </option>
            ))}
        </Select>
    );
}

function FilterControls({
    filters,
    categories,
    onChange,
    ...base
}: ToolbarProps): JSX.Element {
    return (
        <div className="space-y-4">
            <BaseSelect {...base} />
            <Select
                aria-label="Category"
                placeholder="All categories"
                value={filters.category ?? ''}
                onChange={(e) =>
                    onChange({
                        ...filters,
                        category: e.target.value === '' ? null : e.target.value,
                    })
                }
            >
                {categories.map((c) => (
                    <option key={c} value={c}>
                        {c}
                    </option>
                ))}
            </Select>
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-secondary">
                    Include carts and ships
                </span>
                <Switch
                    label="Include carts and ships"
                    checked={filters.includeVehicles}
                    onChange={(next) =>
                        onChange({ ...filters, includeVehicles: next })
                    }
                />
            </div>
        </div>
    );
}

export function MaterialsToolbar(props: ToolbarProps): JSX.Element {
    const { filters, onChange, base, onBase } = props;
    const [isOpen, setOpen] = useState(false);
    const activeCount = activeCountOf(filters, base);
    const clearAll = (): void => {
        onBase(null);
        onChange({ ...filters, category: null, includeVehicles: true });
    };
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <SearchInput
                    className="flex-1"
                    label="Search materials"
                    placeholder="Search items"
                    value={filters.search}
                    onChange={(search) => onChange({ ...filters, search })}
                />
                <FilterEntryTrigger
                    activeCount={activeCount}
                    isOpen={isOpen}
                    onOpenChange={setOpen}
                />
            </div>
            <FilterEntry
                activeCount={activeCount}
                isOpen={isOpen}
                onOpenChange={setOpen}
                onClearAll={clearAll}
            >
                <FilterControls {...props} />
            </FilterEntry>
        </div>
    );
}
