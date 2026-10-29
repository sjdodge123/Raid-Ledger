/**
 * ROK-1862 D8 — the read-only "Not discovered yet" chip on Planner list and
 * plan-tree rows whose recipe the viewer's character has not learned.
 */
import type { JSX } from 'react';
import { StatusChip } from '../../../components/ui/status-chip';
import { DISCOVERY_CHIP_COPY, DISCOVERY_CHIP_TITLE } from './planner.helpers';

export function DiscoveryChip(): JSX.Element {
    return (
        <span data-testid="valheim-undiscovered-chip" className="shrink-0">
            <StatusChip tone="neutral" title={DISCOVERY_CHIP_TITLE}>
                {DISCOVERY_CHIP_COPY}
            </StatusChip>
        </span>
    );
}
