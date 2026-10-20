/**
 * ROK-1854 — pick a target: the shared `Combobox` over the catalogue (name
 * or prefab, D11), a quality `Select` (items only), an amount `Input` and
 * "Add to list"; the list-narrowing filters sit in the `FilterEntry` funnel
 * (toolbar trigger ≥1024px, FAB + sheet below).
 */
import { useMemo, useState, type JSX } from 'react';
import type { ValheimRecipeCatalogEntry } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Combobox } from '../../../components/ui/combobox';
import { FilterEntry, FilterEntryTrigger } from '../../../components/ui/filter-entry';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import {
    activePlannerFilters,
    DEFAULT_PLANNER_FILTERS,
    PLANNER_AMOUNT_MAX,
    type PlannerFilters,
} from './planner.helpers';
import { PlannerFilterControls } from './planner-filters';

type Entry = ValheimRecipeCatalogEntry;

interface PickerProps {
    entries: readonly Entry[];
    filters: PlannerFilters;
    onFilters: (next: PlannerFilters) => void;
    hasPersonal: boolean;
    picked: Entry | null;
    onPick: (entry: Entry | null) => void;
    quality: number;
    onQuality: (q: number) => void;
    onAdd: (amount: number) => void;
}

function narrow(entries: readonly Entry[], f: PlannerFilters, text: string): Entry[] {
    const q = text.trim().toLowerCase();
    return entries.filter(
        (e) =>
            (f.kind === 'both' || e.kind === f.kind) &&
            (f.category === null || e.category === f.category) &&
            (q === '' || e.name.toLowerCase().includes(q) || e.prefab.toLowerCase().includes(q)),
    ).slice(0, 50);
}

function Funnel(props: PickerProps & { isOpen: boolean; setOpen: (o: boolean) => void }): JSX.Element {
    const { entries, filters, onFilters, hasPersonal, isOpen, setOpen } = props;
    const categories = useMemo(() => [...new Set(entries.map((e) => e.category))].sort(), [entries]);
    return (
        <FilterEntry
            activeCount={activePlannerFilters(filters)}
            isOpen={isOpen}
            onOpenChange={setOpen}
            onClearAll={() => onFilters(DEFAULT_PLANNER_FILTERS)}
        >
            <PlannerFilterControls filters={filters} categories={categories} hasPersonal={hasPersonal} onChange={onFilters} />
        </FilterEntry>
    );
}

function AmountRow({ picked, quality, onQuality, onAdd }: Pick<PickerProps, 'picked' | 'quality' | 'onQuality' | 'onAdd'>): JSX.Element {
    const [amount, setAmount] = useState('1');
    const n = Number(amount);
    const valid = Number.isInteger(n) && n >= 1 && n <= PLANNER_AMOUNT_MAX;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {picked !== null && picked.kind === 'item' && picked.maxQuality > 1 && (
                <Select aria-label="Quality" value={String(quality)} onChange={(e) => onQuality(Number(e.target.value))} wrapperClassName="w-28">
                    {Array.from({ length: picked.maxQuality }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                            Quality {i + 1}
                        </option>
                    ))}
                </Select>
            )}
            <Input aria-label="Amount" type="number" min={1} max={PLANNER_AMOUNT_MAX} value={amount} invalid={!valid} onChange={(e) => setAmount(e.target.value)} className="w-24" />
            <Button variant="primary" disabled={picked === null || !valid} onClick={() => onAdd(n)}>
                Add to list
            </Button>
        </div>
    );
}

export function PlannerTargetPicker(props: PickerProps): JSX.Element {
    const { entries, filters, picked, onPick } = props;
    const [text, setText] = useState('');
    const [isOpen, setOpen] = useState(false);
    const options = useMemo(() => narrow(entries, filters, text), [entries, filters, text]);
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Combobox<Entry>
                    className="flex-1"
                    label="Search an item or piece"
                    placeholder="Search an item or piece"
                    options={options}
                    getKey={(e) => `${e.kind}:${e.prefab}`}
                    getLabel={(e) => e.name}
                    value={picked}
                    onChange={onPick}
                    inputValue={text}
                    onInputChange={setText}
                    emptyText="Nothing craftable matches"
                />
                <FilterEntryTrigger activeCount={activePlannerFilters(filters)} isOpen={isOpen} onOpenChange={setOpen} />
            </div>
            <Funnel {...props} isOpen={isOpen} setOpen={setOpen} />
            <AmountRow {...props} />
        </div>
    );
}
