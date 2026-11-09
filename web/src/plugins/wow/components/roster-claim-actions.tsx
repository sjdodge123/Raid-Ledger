/**
 * ROK-2128 claim pieces shared by the Guild-roster list and (ROK-2149) the
 * read-only roster-member page: the Ruleset select. The claim handler lives in
 * `roster-claim-handler.ts`.
 */
import type { JSX } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    WOW_FOREVER_SELECTABLE_RULESETS,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';

export function RulesetSelect({ value, onChange }: { value: WowForeverSelectableRuleset; onChange: (r: WowForeverSelectableRuleset) => void }): JSX.Element {
    return (
        <Field label="Ruleset">
            <Select value={value} onChange={(e) => {
                const next = WOW_FOREVER_SELECTABLE_RULESETS.find((r) => r === e.target.value);
                if (next) onChange(next);
            }}>
                {WOW_FOREVER_SELECTABLE_RULESETS.map((r) => <option key={r} value={r}>{WOW_FOREVER_RULESET_LABELS[r]}</option>)}
            </Select>
        </Field>
    );
}
