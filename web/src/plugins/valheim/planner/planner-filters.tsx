/**
 * ROK-1854 — the Planner's §4.1 funnel body: kind (items / pieces / both),
 * category, "Include my personal chests" (only when the viewer has personal
 * chests) and "Include carts and ships".
 */
import type { JSX } from 'react';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';

export interface PlannerFilters {
    kind: 'both' | 'item' | 'piece';
    category: string | null;
    includePersonal: boolean;
    includeVehicles: boolean;
}

export const DEFAULT_PLANNER_FILTERS: PlannerFilters = {
    kind: 'both',
    category: null,
    includePersonal: false,
    includeVehicles: true,
};

export const activePlannerFilters = (f: PlannerFilters): number =>
    (f.kind === 'both' ? 0 : 1) +
    (f.category === null ? 0 : 1) +
    (f.includePersonal ? 1 : 0) +
    (f.includeVehicles ? 0 : 1);

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-secondary">{label}</span>
            <Switch label={label} checked={checked} onChange={onChange} />
        </div>
    );
}

export function PlannerFilterControls({
    filters,
    categories,
    hasPersonal,
    onChange,
}: {
    filters: PlannerFilters;
    categories: readonly string[];
    hasPersonal: boolean;
    onChange: (next: PlannerFilters) => void;
}): JSX.Element {
    return (
        <div className="space-y-4">
            <Select
                aria-label="Kind"
                value={filters.kind}
                onChange={(e) => onChange({ ...filters, kind: e.target.value as PlannerFilters['kind'] })}
            >
                <option value="both">Items and pieces</option>
                <option value="item">Items</option>
                <option value="piece">Pieces</option>
            </Select>
            <Select
                aria-label="Category"
                placeholder="All categories"
                value={filters.category ?? ''}
                onChange={(e) => onChange({ ...filters, category: e.target.value === '' ? null : e.target.value })}
            >
                {categories.map((c) => (
                    <option key={c} value={c}>
                        {c}
                    </option>
                ))}
            </Select>
            {hasPersonal && (
                <SwitchRow
                    label="Include my personal chests"
                    checked={filters.includePersonal}
                    onChange={(includePersonal) => onChange({ ...filters, includePersonal })}
                />
            )}
            <SwitchRow
                label="Include carts and ships"
                checked={filters.includeVehicles}
                onChange={(includeVehicles) => onChange({ ...filters, includeVehicles })}
            />
        </div>
    );
}
