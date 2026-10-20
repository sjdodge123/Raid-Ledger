/**
 * ROK-1739: one editable row of the realm → ruleset map — region, ruleset,
 * realm name, remove. Phone (<1024px, spec §6.1 / ROK-1864): region + ruleset
 * side by side with remove, the name full-width on the second line; from `lg`
 * the four sit in one grid row under the editor's column header (design-system
 * §4.18). The DOM order is the reading order at every width — no `order-*` —
 * so focus never jumps (WCAG 2.4.3).
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
export const REALM_ROW_GRID = 'grid grid-cols-[6rem_minmax(0,1fr)_auto] items-start gap-2 lg:grid-cols-[7rem_10rem_minmax(0,1fr)_auto]';

/** The name takes the whole phone row under region | ruleset | remove; one column from `lg`. */
const FULL_ROW_ON_PHONE = 'col-span-3 lg:col-span-1';

type RowPatch = Partial<WowForeverRealmRulesetEntryDto>;

interface RowProps {
    row: RealmRulesetRow;
    index: number;
    error: string | undefined;
    onChange: (key: string, patch: RowPatch) => void;
    onRemove: (key: string) => void;
    /** True while a save is pending — locks the row so a remount can't drop later edits. */
    disabled: boolean;
}

type SelectProps = { row: RealmRulesetRow; n: number; onChange: RowProps['onChange']; disabled: boolean };

function RegionSelect({ row, n, onChange, disabled }: SelectProps): JSX.Element {
    const pick = (value: string): void => {
        const parsed = WowRegionSchema.safeParse(value);
        if (parsed.success) onChange(row.key, { region: parsed.data });
    };
    return (
        <Field label={`Region, row ${n}`} hideLabel>
            <Select value={row.region} disabled={disabled} onChange={(e) => pick(e.target.value)}>
                {WowRegionSchema.options.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </Select>
        </Field>
    );
}

function RulesetSelect({ row, n, onChange, disabled }: SelectProps): JSX.Element {
    const pick = (value: string): void => {
        const parsed = WowForeverRulesetSchema.safeParse(value);
        if (parsed.success) onChange(row.key, { ruleset: parsed.data });
    };
    return (
        <Field label={`Ruleset, row ${n}`} hideLabel>
            <Select value={row.ruleset} disabled={disabled} onChange={(e) => pick(e.target.value)}>
                {WowForeverRulesetSchema.options.map((r) => <option key={r} value={r}>{WOW_FOREVER_RULESET_LABELS[r]}</option>)}
            </Select>
        </Field>
    );
}

/** One row; the realm-name field carries the row's inline error. */
export function RealmRulesetRowEditor({ row, index, error, onChange, onRemove, disabled }: RowProps): JSX.Element {
    const n = index + 1;
    const name = row.realmName.trim();
    return (
        <div className={REALM_ROW_GRID}>
            <RegionSelect row={row} n={n} onChange={onChange} disabled={disabled} />
            <RulesetSelect row={row} n={n} onChange={onChange} disabled={disabled} />
            <Button variant="ghost" iconOnly disabled={disabled} aria-label={`Remove ${name === '' ? `row ${n}` : name}`} onClick={() => onRemove(row.key)}>
                <XMarkIcon aria-hidden="true" className="w-5 h-5" />
            </Button>
            <Field label={`Realm name, row ${n}`} hideLabel error={error} className={FULL_ROW_ON_PHONE}>
                <Input type="text" value={row.realmName} maxLength={100} placeholder="Realm name as shown in game" disabled={disabled}
                    onChange={(e) => onChange(row.key, { realmName: e.target.value })} />
            </Field>
        </div>
    );
}
