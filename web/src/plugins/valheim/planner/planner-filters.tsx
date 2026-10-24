/**
 * ROK-1854 — the Planner's §4.1 funnel body: kind (items / pieces / both),
 * category, "Include my personal chests" (only when the viewer has personal
 * chests), "Include carts and ships" and (ROK-1862) "Hide undiscovered",
 * disabled with a hint unless the server could read the viewer's known list.
 */
import { useId, type JSX } from 'react';
import type { ValheimRecipeDiscovery } from '@raid-ledger/contract';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { DISCOVERY_FILTER_LABEL, DISCOVERY_HINT, isPlannerKindFilter, type PlannerFilters } from './planner.helpers';

interface SwitchRowProps {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    /** When set, the switch is disabled and this line explains why. */
    hint?: string | undefined;
}

function SwitchRow({ label, checked, onChange, hint }: SwitchRowProps): JSX.Element {
    const hintId = useId();
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-secondary">{label}</span>
                <Switch label={label} checked={checked} onChange={onChange} disabled={hint !== undefined}
                    {...(hint === undefined ? {} : { 'aria-describedby': hintId })} />
            </div>
            {hint !== undefined && <p id={hintId} className="text-xs text-muted">{hint}</p>}
        </div>
    );
}

interface ControlsProps {
    filters: PlannerFilters;
    categories: readonly string[];
    hasPersonal: boolean;
    /** The catalogue's discovery status; anything but `known` disables "Hide undiscovered". */
    discovery: ValheimRecipeDiscovery;
    onChange: (next: PlannerFilters) => void;
}

function NarrowSelects({ filters, categories, onChange }: Pick<ControlsProps, 'filters' | 'categories' | 'onChange'>): JSX.Element {
    return (
        <>
            <Select
                aria-label="Kind"
                value={filters.kind}
                onChange={(e) => {
                    const v = e.target.value;
                    if (isPlannerKindFilter(v)) onChange({ ...filters, kind: v });
                }}
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
    const { filters, hasPersonal, discovery, onChange } = props;
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
            <SwitchRow
                label={DISCOVERY_FILTER_LABEL}
                checked={filters.hideUndiscovered && discovery === 'known'}
                onChange={(hideUndiscovered) => onChange({ ...filters, hideUndiscovered })}
                hint={discovery === 'known' ? undefined : DISCOVERY_HINT[discovery]}
            />
        </div>
    );
}
