/**
 * ROK-2352 §4.1 — the instance multi-pick on the whole-game page: a Dungeons
 * and a Raids sub-group of checkboxes (catalogue included). None picked = the
 * Any dungeon group. Capped so a submit never half-fails on the per-game hand
 * cap: groups the viewer already holds count toward it (review r1).
 */
import type { JSX } from 'react';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import { Checkbox } from '../../../components/ui/checkbox';
import { LFG_HAND_CAP_COPY } from '../../../hooks/use-lfg-join';
import { orderWowLfgGroups } from './wow-lfg-group-order';
import { wowLfgPickCap } from './wow-lfg-pick-cap';
import { WOW_LFG_COPY, wowLfgGroupLabel } from './wow-lfg-copy';

interface PickerProps {
    groups: readonly LfgGroupListItemDto[];
    picked: readonly string[];
    onChange: (keys: string[]) => void;
}

function PickGroup({ title, testId, groups, picked, disabledFor, toggle }: {
    title: string; testId: string; groups: readonly LfgGroupListItemDto[]; picked: readonly string[];
    disabledFor: (key: string) => boolean; toggle: (key: string, on: boolean) => void;
}): JSX.Element | null {
    if (groups.length === 0) return null;
    return (
        <div role="group" aria-label={title} data-testid={testId} className="space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
            {groups.map((g) => {
                const key = g.groupKey ?? '';
                return (
                    <Checkbox key={key} data-testid={`wow-lfg-instance-${key}`} label={wowLfgGroupLabel(g)}
                        checked={picked.includes(key)} disabled={disabledFor(key)}
                        onChange={(e) => toggle(key, e.currentTarget.checked)} />
                );
            })}
        </div>
    );
}

/** Checkboxes for every keyed group, dungeons then raids. */
export function WowLfgInstancePicker({ groups, picked, onChange }: PickerProps): JSX.Element | null {
    const { dungeons, raids } = orderWowLfgGroups(groups);
    if (dungeons.length + raids.length === 0) return null;
    const { held, atCap } = wowLfgPickCap(groups, picked);
    const disabledFor = (key: string): boolean => atCap && !picked.includes(key) && !held.has(key);
    const toggle = (key: string, on: boolean): void =>
        onChange(on ? [...picked, key] : picked.filter((k) => k !== key));
    const shared = { picked, disabledFor, toggle };
    return (
        <fieldset data-testid="wow-lfg-instances" className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{WOW_LFG_COPY.instancesLegend}</legend>
            {atCap && <p data-testid="wow-lfg-instances-cap" className="text-xs text-muted">{LFG_HAND_CAP_COPY}</p>}
            <div className="max-h-64 space-y-3 overflow-y-auto">
                <PickGroup title={WOW_LFG_COPY.dungeons} testId="wow-lfg-instances-dungeons" groups={dungeons} {...shared} />
                <PickGroup title={WOW_LFG_COPY.raids} testId="wow-lfg-instances-raids" groups={raids} {...shared} />
            </div>
        </fieldset>
    );
}
