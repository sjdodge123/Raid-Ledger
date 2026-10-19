/**
 * ROK-1739: one editable row of the realm → ruleset map — region, realm name,
 * ruleset, remove. Phone (<1024px): region + ruleset + remove on one line and
 * the name full-width under them; from `lg` the four sit in one grid row
 * under the editor's column header (design-system §4.18).
 */
import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
    WOW_FOREVER_RULESET_LABELS,
    WowForeverRulesetSchema,
    WowRegionSchema,
    type WowForeverRealmRulesetEntryDto,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import type { RealmRulesetRow } from './forever-realm-rulesets.helpers';

/** Shared with the editor's desktop column header so the two line up. */
export const REALM_ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 lg:grid-cols-[7rem_minmax(0,1fr)_10rem_auto] lg:items-start';

type RowPatch = Partial<WowForeverRealmRulesetEntryDto>;

interface RowProps {
    row: RealmRulesetRow;
    index: number;
    error: string | undefined;
    onChange: (key: string, patch: RowPatch) => void;
    onRemove: (key: string) => void;
}

function RegionSelect({ row, n, onChange }: { row: RealmRulesetRow; n: number; onChange: RowProps['onChange'] }): JSX.Element {
    const pick = (value: string): void => {
        const parsed = WowRegionSchema.safeParse(value);
        if (parsed.success) onChange(row.key, { region: parsed.data });
    };
    return (
        <Field label={`Region, row ${n}`} hideLabel>
            <Select value={row.region} onChange={(e) => pick(e.target.value)}>
                {WowRegionSchema.options.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </Select>
        </Field>
    );
}

function RulesetSelect({ row, n, onChange }: { row: RealmRulesetRow; n: number; onChange: RowProps['onChange'] }): JSX.Element {
    const pick = (value: string): void => {
        const parsed = WowForeverRulesetSchema.safeParse(value);
        if (parsed.success) onChange(row.key, { ruleset: parsed.data });
    };
    return (
        <Field label={`Ruleset, row ${n}`} hideLabel>
            <Select value={row.ruleset} onChange={(e) => pick(e.target.value)}>
                {WowForeverRulesetSchema.options.map((r) => <option key={r} value={r}>{WOW_FOREVER_RULESET_LABELS[r]}</option>)}
            </Select>
        </Field>
    );
}

/** One row; the realm-name field carries the row's inline error. */
export function RealmRulesetRowEditor({ row, index, error, onChange, onRemove }: RowProps): JSX.Element {
    const n = index + 1;
    const name = row.realmName.trim();
    return (
        <div className={REALM_ROW_GRID}>
            <RegionSelect row={row} n={n} onChange={onChange} />
            <Field label={`Realm name, row ${n}`} hideLabel error={error} className="col-span-3 order-1 lg:order-none lg:col-span-1">
                <Input type="text" value={row.realmName} maxLength={100} placeholder="Realm name as shown in game"
                    onChange={(e) => onChange(row.key, { realmName: e.target.value })} />
            </Field>
            <RulesetSelect row={row} n={n} onChange={onChange} />
            <Button variant="ghost" iconOnly aria-label={`Remove ${name === '' ? `row ${n}` : name}`} onClick={() => onRemove(row.key)}>
                <XMarkIcon aria-hidden="true" className="w-5 h-5" />
            </Button>
        </div>
    );
}
