/**
 * ROK-1854 — the Planner's §4.1 funnel body: kind (items / pieces / both),
 * category, "Include my personal chests" (only when the viewer has personal
 * chests) and "Include carts and ships".
 */
import type { JSX } from 'react';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import type { PlannerFilters } from './planner.helpers';

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }): JSX.Element {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-secondary">{label}</span>
            <Switch label={label} checked={checked} onChange={onChange} />
        </div>
    );
}

interface ControlsProps {
    filters: PlannerFilters;
    categories: readonly string[];
    hasPersonal: boolean;
    onChange: (next: PlannerFilters) => void;
}

function NarrowSelects({ filters, categories, onChange }: Omit<ControlsProps, 'hasPersonal'>): JSX.Element {
    return (
        <>
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
        </>
    );
}

export function PlannerFilterControls(props: ControlsProps): JSX.Element {
    const { filters, hasPersonal, onChange } = props;
    return (
        <div className="space-y-4">
            <NarrowSelects {...props} />
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
