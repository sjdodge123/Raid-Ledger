/**
 * ForeverIdentityFields (ROK-1721): the WoW: Forever identity block — Region,
 * Ruleset, First + Second name and a live "Shown in-game as" preview. It
 * replaces the Name and Realm inputs in every manual add surface when the
 * selected game is WoW: Forever. Pairs sit two-up from 640px and stack one
 * per row below it.
 */
import type { JSX } from 'react';
import { WOW_FOREVER_RULESET_LABELS, WOW_FOREVER_SELECTABLE_RULESETS, type WowForeverRuleset, type WowRegion } from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { RadioGroup, type RadioOption } from '../../../components/ui/radio-group';
import type { ForeverIdentity, ForeverIdentityErrors } from '../lib/forever-identity';

const REGIONS: readonly WowRegion[] = ['us', 'eu', 'kr', 'tw'];

interface ForeverIdentityFieldsProps {
    value: ForeverIdentity;
    onChange: (next: ForeverIdentity) => void;
    errors?: ForeverIdentityErrors | undefined;
    /** Edit mode: region is part of the identity and cannot change. */
    regionLocked?: boolean | undefined;
    /** Smaller controls for the inline signup form. */
    compact?: boolean | undefined;
}

/** Pickable rulesets, plus a stored Hardcore value so an existing character still shows it. */
function rulesetOptions(current: WowForeverRuleset): RadioOption<WowForeverRuleset>[] {
    const values: WowForeverRuleset[] = [...WOW_FOREVER_SELECTABLE_RULESETS];
    if (!values.includes(current)) values.push(current);
    return values.map((v) => ({ value: v, label: WOW_FOREVER_RULESET_LABELS[v] }));
}

function RegionField({ value, locked, compact, onChange }: {
    value: WowRegion; locked: boolean; compact: boolean; onChange: (r: WowRegion) => void;
}): JSX.Element {
    return (
        <Field label="Region" required hint={locked ? "Region can't be changed after creation" : undefined}>
            <Select fieldSize={compact ? 'sm' : 'md'} value={value} disabled={locked}
                onChange={(e) => onChange(e.target.value as WowRegion)}>
                {REGIONS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </Select>
        </Field>
    );
}

function NamePartField({ label, value, error, compact, onChange }: {
    label: string; value: string; error?: string | undefined; compact: boolean; onChange: (v: string) => void;
}): JSX.Element {
    return (
        <Field label={label} required error={error}>
            <Input type="text" fieldSize={compact ? 'sm' : 'md'} value={value} maxLength={24}
                onChange={(e) => onChange(e.target.value)} placeholder={label} autoComplete="off" />
        </Field>
    );
}

function NamePreview({ value }: { value: ForeverIdentity }): JSX.Element | null {
    const first = value.first.trim();
    const second = value.second.trim();
    if (!first || !second) return null;
    return <p className="text-xs text-muted">Shown in-game as “{first} {second}” (second name may be hidden)</p>;
}

export function ForeverIdentityFields({ value, onChange, errors, regionLocked = false, compact = false }: ForeverIdentityFieldsProps): JSX.Element {
    const set = <K extends keyof ForeverIdentity>(k: K, v: ForeverIdentity[K]) => onChange({ ...value, [k]: v });
    return (
        <div className="space-y-3" data-testid="forever-identity-fields">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <RegionField value={value.region} locked={regionLocked} compact={compact} onChange={(r) => set('region', r)} />
                <RadioGroup label="Ruleset" appearance="segmented" options={rulesetOptions(value.ruleset)}
                    value={value.ruleset} onChange={(r) => set('ruleset', r)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NamePartField label="First name" value={value.first} error={errors?.first} compact={compact} onChange={(v) => set('first', v)} />
                <NamePartField label="Second name" value={value.second} error={errors?.second} compact={compact} onChange={(v) => set('second', v)} />
            </div>
            {errors?.name && <p role="alert" className="text-sm text-danger">{errors.name}</p>}
            <NamePreview value={value} />
        </div>
    );
}
