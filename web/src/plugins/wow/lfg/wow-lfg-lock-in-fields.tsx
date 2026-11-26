/**
 * ROK-2352 §3.4 / §4.1 — the WoW lock-in fields: on the Any-dungeon group the
 * creator picks an instance (`lfgChosenGroupKey`, absent = generic roster);
 * every group shows the roster preview the event gets.
 */
import { useState, type JSX } from 'react';
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import type { LfgLockInFieldsProps } from '../../lfg-grouping';
import { useLfgGameGroups } from '../../../hooks/use-lfg-game-groups';
import { Select } from '../../../components/ui/select';
import { WowLfgCoverageStrip } from './wow-lfg-coverage-strip';
import { orderWowLfgGroups } from './wow-lfg-group-order';
import { WOW_LFG_COPY, wowLfgGroupLabel } from './wow-lfg-copy';

function InstanceSelect({ options, value, onPick }: {
    options: readonly LfgGroupListItemDto[]; value: string; onPick: (key: string) => void;
}): JSX.Element {
    return (
        <label className="block space-y-1 text-sm text-foreground">
            <span className="font-medium">{WOW_LFG_COPY.lockInInstance}</span>
            <Select data-testid="wow-lfg-lockin-instance" value={value} placeholder={WOW_LFG_COPY.lockInNoInstance}
                onChange={(e) => onPick(e.currentTarget.value)}>
                {options.map((g) => (
                    <option key={g.groupKey ?? ''} value={g.groupKey ?? ''}>{wowLfgGroupLabel(g)}</option>
                ))}
            </Select>
        </label>
    );
}

/** The `LockInFields` component of the WoW `lfg-grouping` registration. */
export function WowLfgLockInFields({ context, onChange }: LfgLockInFieldsProps): JSX.Element {
    const groups = useLfgGameGroups(context.gameId, true).data?.groups ?? [];
    const [chosen, setChosen] = useState('');
    const onAny = context.groupKey === '';
    const { dungeons, raids } = orderWowLfgGroups(groups);
    const previewKey = onAny ? chosen : context.groupKey;
    const shape = groups.find((g) => (g.groupKey ?? '') === previewKey && previewKey !== '')?.rosterShape;
    const pick = (key: string): void => {
        setChosen(key);
        onChange(key === '' ? {} : { lfgChosenGroupKey: key });
    };
    return (
        <div data-testid="wow-lfg-lockin-fields" className="space-y-2">
            {onAny && <InstanceSelect options={[...dungeons, ...raids]} value={chosen} onPick={pick} />}
            {shape && (
                <div className="space-y-1">
                    <p className="text-xs font-medium text-muted">{WOW_LFG_COPY.rosterPreview}</p>
                    <WowLfgCoverageStrip shape={shape} />
                </div>
            )}
        </div>
    );
}
