/**
 * ROK-1173 (AC2) — the WoW Members filter controls. Core renders this inside
 * its `FilterEntry` (inline panel at 1024px and up, bottom sheet below), so it
 * is only the field set: chip groups for Class / Role / Rank / Profession, a
 * Level min–max pair and the "Linked to an RL account only" switch.
 */
import type { JSX, ReactNode } from 'react';
import { FilterChip } from '../../../components/ui/filter-chip';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Switch } from '../../../components/ui/switch';
import {
    PROFESSION_FILTER_LABEL, WOW_ROLE_OPTIONS, clampLevel, toggleValue,
    type ProfessionCoverage, type WowMemberFilterOptions, type WowMemberFilterState,
} from './wow-member-filters.helpers';

const LEGEND = 'mb-1.5 text-sm font-medium text-secondary';

export interface WowMemberFilterControlsProps {
    state: WowMemberFilterState;
    options: WowMemberFilterOptions;
    /** Profession options from roster insights; undefined (visitor / loading) or empty hides the group. */
    professions: readonly ProfessionCoverage[] | undefined;
    onChange: (next: WowMemberFilterState) => void;
}

function ChipGroup({ legend, testId, children }: { legend: string; testId: string; children: ReactNode }): JSX.Element {
    return (
        <fieldset data-testid={testId} className="min-w-0">
            <legend className={LEGEND}>{legend}</legend>
            <div className="flex flex-wrap gap-2">{children}</div>
        </fieldset>
    );
}

function parseLevel(raw: string, maxLevel: number | null): number | null {
    return raw.trim() === '' ? null : clampLevel(Number(raw), maxLevel);
}

function LevelFields({ state, maxLevel, onChange }: { state: WowMemberFilterState; maxLevel: number | null; onChange: (s: WowMemberFilterState) => void }): JSX.Element {
    const max = maxLevel ?? undefined;
    return (
        <fieldset data-testid="wow-filter-level" className="min-w-0">
            <legend className={LEGEND}>Level</legend>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Min level">
                    <Input type="number" inputMode="numeric" min={1} max={max} value={state.levelMin ?? ''}
                        onChange={(e) => onChange({ ...state, levelMin: parseLevel(e.target.value, maxLevel) })} />
                </Field>
                <Field label="Max level">
                    <Input type="number" inputMode="numeric" min={1} max={max} value={state.levelMax ?? ''}
                        onChange={(e) => onChange({ ...state, levelMax: parseLevel(e.target.value, maxLevel) })} />
                </Field>
            </div>
        </fieldset>
    );
}

function LinkedField({ state, onChange }: { state: WowMemberFilterState; onChange: (s: WowMemberFilterState) => void }): JSX.Element {
    const label = 'Linked to an RL account only';
    return (
        <div className="flex items-center justify-between gap-3 min-h-[44px]">
            <span className="text-base lg:text-sm font-medium text-foreground">{label}</span>
            <Switch checked={state.linkedOnly} onChange={(linkedOnly) => onChange({ ...state, linkedOnly })} label={label} testId="wow-filter-linked" />
        </div>
    );
}

function ClassRoleRank({ state, options, onChange }: Omit<WowMemberFilterControlsProps, 'professions'>): JSX.Element {
    return (
        <div className="flex flex-col gap-5">
            {options.classes.length > 0 && (
                <ChipGroup legend="Class" testId="wow-filter-class">
                    {options.classes.map((c) => (
                        <FilterChip key={c} label={c} pressed={state.classes.includes(c)}
                            onPressedChange={() => onChange({ ...state, classes: toggleValue(state.classes, c) })} />
                    ))}
                </ChipGroup>
            )}
            <ChipGroup legend="Role" testId="wow-filter-role">
                {WOW_ROLE_OPTIONS.map((r) => (
                    <FilterChip key={r.value} label={r.label} pressed={state.roles.includes(r.value)}
                        onPressedChange={() => onChange({ ...state, roles: toggleValue(state.roles, r.value) })} />
                ))}
            </ChipGroup>
            <ChipGroup legend="Rank" testId="wow-filter-rank">
                {options.ranks.map((r) => (
                    <FilterChip key={r.key} label={r.label} pressed={state.ranks.includes(r.key)}
                        onPressedChange={() => onChange({ ...state, ranks: toggleValue(state.ranks, r.key) })} />
                ))}
            </ChipGroup>
        </div>
    );
}

/** The whole WoW field set: two columns on desktop, one stack in the sheet. */
export function WowMemberFilterControls({ state, options, professions, onChange }: WowMemberFilterControlsProps): JSX.Element {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <ClassRoleRank state={state} options={options} onChange={onChange} />
            <div className="flex flex-col gap-5">
                <LevelFields state={state} maxLevel={options.maxLevel} onChange={onChange} />
                <LinkedField state={state} onChange={onChange} />
                {professions !== undefined && professions.length > 0 && (
                    <ChipGroup legend={PROFESSION_FILTER_LABEL} testId="wow-filter-profession">
                        {professions.map((p) => (
                            <FilterChip key={p.name} label={p.name} pressed={state.professions.includes(p.name)}
                                onPressedChange={() => onChange({ ...state, professions: toggleValue(state.professions, p.name) })} />
                        ))}
                    </ChipGroup>
                )}
            </div>
        </div>
    );
}
