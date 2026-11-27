/**
 * ROK-2352 §3.4 — the role coverage strip: one pill per role of the roster
 * shape. With server `coverage` it reads "filled/needed"; without it, it
 * states the shape only ("1 tank") — it never invents a fill of 0.
 */
import type { JSX } from 'react';
import type { LfgRoleCounts } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';

const ROLES = [
    { key: 'tank', label: 'tank' },
    { key: 'healer', label: 'healer' },
    { key: 'dps', label: 'dps' },
] as const;

export interface WowLfgCoverageStripProps {
    shape: LfgRoleCounts;
    coverage?: LfgRoleCounts | undefined;
}

/** Tank / healer / dps pills sized by the group's roster shape. */
export function WowLfgCoverageStrip({ shape, coverage }: WowLfgCoverageStripProps): JSX.Element {
    return (
        <ul data-testid="wow-lfg-coverage" aria-label="Roles needed" className="flex flex-wrap gap-1.5">
            {ROLES.map(({ key, label }) => {
                const needed = shape[key];
                const filled = coverage?.[key];
                const text = filled === undefined ? `${needed} ${label}` : `${Math.min(filled, needed)}/${needed} ${label}`;
                return (
                    <li key={key} data-testid={`wow-lfg-coverage-${key}`}>
                        <StatusChip tone={filled !== undefined && filled >= needed ? 'success' : 'neutral'} title={`${label}: ${text}`}>
                            {text}
                        </StatusChip>
                    </li>
                );
            })}
        </ul>
    );
}
