/**
 * Ruleset picker for a create-route import whose export has no ruleset
 * (ROK-1738 ruling Q3, D13). The inventory `RadioGroup` segmented control with
 * the SELECTABLE rulesets only (no Hardcore — the same list Add Character's
 * Forever fields use) and nothing pre-selected: `RadioGroup` is controlled by
 * `value`, so the `''` sentinel checks no segment until the user picks.
 */
import type { JSX } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    WOW_FOREVER_SELECTABLE_RULESETS,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { RadioGroup, type RadioOption } from '../../../../components/ui/radio-group';

type PickValue = WowForeverSelectableRuleset | '';

const OPTIONS: readonly RadioOption<PickValue>[] = WOW_FOREVER_SELECTABLE_RULESETS.map((v) => ({
    value: v,
    label: WOW_FOREVER_RULESET_LABELS[v],
}));

export interface AddonImportRulesetPickerProps {
    value: WowForeverSelectableRuleset | null;
    onChange: (value: WowForeverSelectableRuleset) => void;
}

export function AddonImportRulesetPicker({ value, onChange }: AddonImportRulesetPickerProps): JSX.Element {
    return (
        <div data-testid="addon-import-ruleset-picker" className="space-y-1.5">
            <RadioGroup<PickValue>
                label="Ruleset" appearance="segmented" options={OPTIONS}
                value={value ?? ''} onChange={(v) => { if (v !== '') onChange(v); }}
            />
            <p className="text-sm text-muted">The export doesn&apos;t say which ruleset this character plays on.</p>
        </div>
    );
}
