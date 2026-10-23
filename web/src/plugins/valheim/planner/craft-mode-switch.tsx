/**
 * ROK-1899 — CRAFT | UPGRADE (spec §3.1.2): a segmented `RadioGroup`, not
 * `TabRow` — the hub already owns the URL hash for its tabs. UPGRADE carries
 * the number of upgradable rows under the current filters.
 */
import type { JSX } from 'react';
import { RadioGroup } from '../../../components/ui/radio-group';
import type { CraftMode } from './crafting.helpers';

export interface CraftModeSwitchProps {
    value: CraftMode;
    onChange: (mode: CraftMode) => void;
    upgradeCount: number;
    className?: string;
}

/** The mode switch. */
export function CraftModeSwitch({ value, onChange, upgradeCount, className }: CraftModeSwitchProps): JSX.Element {
    return (
        <RadioGroup<CraftMode>
            label="Mode"
            hideLabel
            appearance="segmented"
            className={className}
            value={value}
            onChange={onChange}
            options={[
                { value: 'craft', label: 'CRAFT' },
                {
                    value: 'upgrade',
                    label: (
                        <span className="inline-flex items-center gap-1.5">
                            UPGRADE
                            <span className="rounded-full bg-surface px-1.5 font-mono text-xs text-muted">{upgradeCount}</span>
                        </span>
                    ),
                },
            ]}
        />
    );
}
