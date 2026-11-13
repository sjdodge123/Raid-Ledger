/**
 * ROK-1790 — the Crafters toolbar: `SearchInput` (profession or character
 * name) plus the §4.1 funnel standard (`filter-entry.tsx`): the toolbar
 * trigger + inline panel at 1024px and up, the neutral Filters FAB +
 * `BottomSheet` below. Filter body per operator ruling 2026-11-12 Q3:
 * Profession (multi-select `FilterChip`s) and Minimum skill (a segmented
 * `RadioGroup`, §4.11: one choice, "Any" is the `null` sentinel). Same layout as the Valheim Materials toolbar.
 */
import { useState, type JSX } from 'react';
import { FilterEntry, FilterEntryTrigger } from '../../../../components/ui/filter-entry';
import { FilterChip } from '../../../../components/ui/filter-chip';
import { SearchInput } from '../../../../components/ui/search-input';
import { RadioGroup } from '../../../../components/ui/radio-group';
import { EMPTY_CRAFTER_FILTERS, MIN_SKILL_OPTIONS, activeCount, type CrafterFilters } from './crafters.helpers';

interface CraftersToolbarProps {
    query: string;
    onQuery: (query: string) => void;
    filters: CrafterFilters;
    onFilters: (next: CrafterFilters) => void;
    /** Profession names for the chips, A–Z (`professionOptions`). */
    professions: readonly string[];
}

/** Search box + funnel; "Clear all" resets the filters, never the search (spec AC4). */
export function CraftersToolbar({ query, onQuery, filters, onFilters, professions }: CraftersToolbarProps): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const count = activeCount(filters);
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <SearchInput className="flex-1" label="Search professions or crafters" placeholder="Search profession or name"
                    value={query} onChange={onQuery} />
                <FilterEntryTrigger activeCount={count} isOpen={isOpen} onOpenChange={setOpen} />
            </div>
            <FilterEntry activeCount={count} isOpen={isOpen} onOpenChange={setOpen} onClearAll={() => onFilters(EMPTY_CRAFTER_FILTERS)}>
                <CrafterFilterControls filters={filters} onFilters={onFilters} professions={professions} />
            </FilterEntry>
        </div>
    );
}

/** Radio values are strings; "Any" (`null`) maps to the `any` sentinel. */
function minSkillKey(value: number | null): string {
    return value === null ? 'any' : String(value);
}

function minSkillFromKey(key: string): number | null {
    return MIN_SKILL_OPTIONS.find((o) => minSkillKey(o.value) === key)?.value ?? null;
}

const MIN_SKILL_RADIOS = MIN_SKILL_OPTIONS.map((o) => ({ value: minSkillKey(o.value), label: o.label }));

type ControlsProps = Pick<CraftersToolbarProps, 'filters' | 'onFilters' | 'professions'>;

function CrafterFilterControls({ filters, onFilters, professions }: ControlsProps): JSX.Element {
    const toggleProfession = (name: string, on: boolean): void => {
        const rest = filters.professions.filter((p) => p !== name);
        onFilters({ ...filters, professions: on ? [...rest, name] : rest });
    };
    return (
        <div className="flex flex-col gap-4">
            <ChipGroup title="Profession">
                {professions.map((name) => (
                    <FilterChip key={name} label={name} pressed={filters.professions.includes(name)}
                        onPressedChange={(on) => toggleProfession(name, on)} />
                ))}
            </ChipGroup>
            <RadioGroup label="Minimum skill" appearance="segmented" options={MIN_SKILL_RADIOS}
                value={minSkillKey(filters.minSkill)} onChange={(key) => onFilters({ ...filters, minSkill: minSkillFromKey(key) })} />
        </div>
    );
}

function ChipGroup({ title, children }: { title: string; children: JSX.Element[] }): JSX.Element {
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">{title}</legend>
            <div className="flex flex-wrap gap-2">{children}</div>
        </fieldset>
    );
}
