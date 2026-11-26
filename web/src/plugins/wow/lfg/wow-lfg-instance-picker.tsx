/**
 * ROK-2352 §4.1 — the instance multi-pick on the whole-game page: one
 * checkbox per dungeon / raid group (catalogue included). None picked = the
 * Any dungeon group.
 */
import type { JSX } from 'react';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { Checkbox } from '../../../components/ui/checkbox';
import { orderWowLfgGroups } from './wow-lfg-group-order';
import { WOW_LFG_COPY, wowLfgGroupLabel } from './wow-lfg-copy';

/** Checkboxes for every keyed group, dungeons then raids. */
export function WowLfgInstancePicker({ groups, picked, onChange }: {
    groups: readonly LfgGroupListItemDto[]; picked: readonly string[]; onChange: (keys: string[]) => void;
}): JSX.Element | null {
    const { dungeons, raids } = orderWowLfgGroups(groups);
    const options = [...dungeons, ...raids];
    if (options.length === 0) return null;
    const toggle = (key: string, on: boolean): void =>
        onChange(on ? [...picked, key] : picked.filter((k) => k !== key));
    return (
        <fieldset data-testid="wow-lfg-instances" className="space-y-1">
            <legend className="text-sm font-medium text-foreground">{WOW_LFG_COPY.instancesLegend}</legend>
            <div className="max-h-64 overflow-y-auto">
                {options.map((g) => {
                    const key = g.groupKey ?? '';
                    return (
                        <Checkbox key={key} data-testid={`wow-lfg-instance-${key}`} label={wowLfgGroupLabel(g)}
                            checked={picked.includes(key)} onChange={(e) => toggle(key, e.currentTarget.checked)} />
                    );
                })}
            </div>
        </fieldset>
    );
}
